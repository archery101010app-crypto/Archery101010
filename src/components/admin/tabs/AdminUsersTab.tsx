"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  Search, 
  Eye, 
  Sparkles, 
  User, 
  Mail, 
  Shield, 
  Award, 
  Download, 
  RefreshCw, 
  FileSpreadsheet, 
  UserCheck, 
  Calendar, 
  Flame,
  Target,
  Crown,
  ChevronDown,
  Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { getLocalSetting, saveLocalSetting, generateResilientId } from "@/lib/db/indexedDB";
import { COUNTRIES, COUNTRIES_MAP } from "@/lib/countries";
import { downloadOrShareFile } from "@/lib/fileDownload";
import { showOledAlert } from "@/lib/oledDialog";
import {
  ADMIN_PAGE_SIZE,
  AdminGlobalCounts,
  fetchAdminGlobalCounts,
  fetchAdminUsersPage,
  searchAdminUsersInCloud
} from "@/lib/adminCloudPagination";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { getLocalISODate, formatRegionalDate } from "@/lib/i18n/regionalUtils";

export default function AdminUsersTab() {
  const { language } = useLanguage();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [planFilter, setPlanFilter] = useState<string>("ALL");
  const [bowFilter, setBowFilter] = useState<string>("ALL");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSearchingCloud, setIsSearchingCloud] = useState(false);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [globalCounts, setGlobalCounts] = useState<AdminGlobalCounts | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const nextCursorRef = useRef<any>(null);

  // Helper to format timestamps gracefully
  const formatRegistrationDate = (timestamp?: number | string) => {
    if (!timestamp) return "Fecha no registrada";
    const num = typeof timestamp === "string" ? parseInt(timestamp, 10) : timestamp;
    if (isNaN(num)) return "Fecha no registrada";
    const date = new Date(num);
    if (isNaN(date.getTime())) return "Fecha no registrada";
    return formatRegionalDate(date, language, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  // Check if registered within last 48 hours
  const isRecentUser = (user: UserProfile) => {
    const ts = user.createdAt || (user.lastActiveAt ? user.lastActiveAt : null);
    if (!ts) return false;
    const diffHours = (Date.now() - ts) / (1000 * 60 * 60);
    return diffHours >= 0 && diffHours <= 48;
  };

  // Load local users first (zero latency)
  const loadLocalUsers = useCallback(async () => {
    const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
    setUsers(list);
    return list;
  }, []);

  // Fetch first 50-user cursor page + exact server KPI counts from Firestore
  const refreshUsersFromFirestore = useCallback(async () => {
    setIsRefreshing(true);
    setSyncMessage("Sincronizando con Firestore...");
    try {
      const localList = await loadLocalUsers();

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const [pageRes, countsRes] = await Promise.all([
          fetchAdminUsersPage(null, ADMIN_PAGE_SIZE),
          fetchAdminGlobalCounts()
        ]);

        nextCursorRef.current = pageRes.lastCursor;
        setHasMoreUsers(pageRes.hasMore);
        if (countsRes) {
          setGlobalCounts(countsRes);
        }

        const remoteUsers = pageRes.users;
        if (remoteUsers.length > 0) {
          const mergedMap = new Map<string, UserProfile>();

          localList.forEach((u) => {
            const key = u.uid || (u.email || "").toLowerCase();
            if (key && key !== "USR-GUEST-OFFLINE") mergedMap.set(key, u);
          });

          remoteUsers.forEach((u) => {
            const key = u.uid || (u.email || "").toLowerCase();
            if (!key || key === "USR-GUEST-OFFLINE") return;
            const existing = mergedMap.get(key);
            mergedMap.set(key, { ...existing, ...u });
          });

          const finalList = Array.from(mergedMap.values());
          finalList.sort((a, b) => {
            const timeA = a.createdAt || a.lastActiveAt || 0;
            const timeB = b.createdAt || b.lastActiveAt || 0;
            return timeB - timeA;
          });

          setUsers(finalList);
          await saveLocalSetting("simulated_users", finalList);
          const totalLabel = countsRes ? ` de ${countsRes.totalUsers.toLocaleString()}` : "";
          setSyncMessage(`${finalList.length}${totalLabel} arqueros sincronizados`);
        } else {
          setSyncMessage(`${localList.length} arqueros locales cargados`);
        }
      } else {
        setSyncMessage(`Modo offline: ${localList.length} arqueros cargados`);
      }
    } catch (err) {
      console.warn("[Admin Users] Firestore fetch error:", err);
      setSyncMessage("Error de conexión. Mostrando arqueros locales.");
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setSyncMessage(null), 4000);
    }
  }, [loadLocalUsers]);

  // Load next 50 users page via Firestore cursor
  const handleLoadMoreUsers = async () => {
    if (isLoadingMore || !hasMoreUsers) return;
    setIsLoadingMore(true);
    try {
      const pageRes = await fetchAdminUsersPage(nextCursorRef.current, ADMIN_PAGE_SIZE);
      nextCursorRef.current = pageRes.lastCursor;
      setHasMoreUsers(pageRes.hasMore);

      if (pageRes.users.length > 0) {
        setUsers((prev) => {
          const mergedMap = new Map<string, UserProfile>();
          prev.forEach((u) => {
            const key = u.uid || (u.email || "").toLowerCase();
            if (key) mergedMap.set(key, u);
          });
          pageRes.users.forEach((u) => {
            const key = u.uid || (u.email || "").toLowerCase();
            if (!key) return;
            const existing = mergedMap.get(key);
            mergedMap.set(key, { ...existing, ...u });
          });
          const next = Array.from(mergedMap.values()).sort((a, b) => {
            const timeA = a.createdAt || a.lastActiveAt || 0;
            const timeB = b.createdAt || b.lastActiveAt || 0;
            return timeB - timeA;
          });
          saveLocalSetting("simulated_users", next).catch(() => {});
          return next;
        });
      }
    } catch (err) {
      console.warn("[Admin Users] Load more error:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Direct Cloud Search across 100,000+ accounts when typing >= 2 chars
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
          const mergedMap = new Map<string, UserProfile>();
          prev.forEach((u) => {
            const key = u.uid || (u.email || "").toLowerCase();
            if (key) mergedMap.set(key, u);
          });
          cloudMatches.forEach((u) => {
            const key = u.uid || (u.email || "").toLowerCase();
            if (!key) return;
            const existing = mergedMap.get(key);
            mergedMap.set(key, { ...existing, ...u });
          });
          return Array.from(mergedMap.values()).sort((a, b) => {
            const timeA = a.createdAt || a.lastActiveAt || 0;
            const timeB = b.createdAt || b.lastActiveAt || 0;
            return timeB - timeA;
          });
        });
      } catch (err) {
        console.warn("[Admin Users] Cloud search error:", err);
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
    refreshUsersFromFirestore();

    const handleDbChange = (e: any) => {
      if (e.detail?.store === "simulated_users") {
        loadLocalUsers();
      }
    };

    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, [refreshUsersFromFirestore, loadLocalUsers]);

  // Helper to calculate exact age from YYYY-MM-DD birthDate
  const calculateAge = (birthDate?: string): number | null => {
    if (!birthDate) return null;
    const parts = birthDate.split("-");
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    const today = new Date();
    let age = today.getFullYear() - year;
    const m = today.getMonth() - month;
    if (m < 0 || (m === 0 && today.getDate() < day)) {
      age--;
    }
    return age >= 0 && age <= 115 ? age : null;
  };

  const getWACategory = (age: number | null): string => {
    if (age === null) return "N/A";
    if (age < 15) return "Sub-15";
    if (age < 18) return "Sub-18 (Cadete)";
    if (age < 21) return "Sub-21 (Junior)";
    if (age < 50) return "Mayor (Senior)";
    return "Master (50+)";
  };

  // Export users to CSV / Excel using mobile-resilient download/share helper
  const handleExportCSV = async () => {
    if (users.length === 0) {
      await showOledAlert("No hay usuarios para exportar.");
      return;
    }

    const headers = [
      "ID",
      "Nombre Completo",
      "Alias / Gamertag",
      "Correo",
      "Mensajería",
      "Edad",
      "Categoría WA",
      "Fecha de Nacimiento",
      "Género",
      "Ciudad",
      "País",
      "Club",
      "Rol",
      "Plan",
      "Tipo de Arco",
      "Marca Arco",
      "Modelo Arco",
      "Potencia (lbs)",
      "Distancia Default (m)",
      "Estatura (cm)",
      "Peso (kg)",
      "Ojo Dominante",
      "Mano Dominante",
      "Fecha de Registro"
    ];

    const escapeCSV = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = users.map((u) => {
      const countryName =
        COUNTRIES.find((c) => c.code === u.country)?.name ||
        COUNTRIES_MAP[u.country]?.name ||
        u.country ||
        "N/A";
      const age = calculateAge(u.birthDate);
      const waCategory = getWACategory(age);
      const genderLabel =
        u.gender === "M" ? "Masculino" : u.gender === "F" ? "Femenino" : u.gender === "O" ? "Otro" : "N/A";
      const bowType = u.bowConfig?.type || "Barebow";
      const bowBrand = u.bowConfig?.brand || "";
      const bowModel = u.bowConfig?.model || "";
      const poundage = u.bowConfig?.poundage || "";
      const distance = u.bowConfig?.defaultDistance || "";
      const height = u.physicalData?.height || "";
      const weight = u.physicalData?.weight || "";
      const domEye = u.physicalData?.dominantEye || "";
      const domHand = u.physicalData?.dominantHand || "";
      const regDate = formatRegistrationDate(u.createdAt || u.lastActiveAt);

      return [
        escapeCSV(u.uid),
        escapeCSV(u.fullName),
        escapeCSV(u.nickname ? `@${u.nickname}` : ""),
        escapeCSV(u.email),
        escapeCSV(u.whatsappNumber || ""),
        escapeCSV(age !== null ? age : "N/A"),
        escapeCSV(waCategory),
        escapeCSV(u.birthDate || ""),
        escapeCSV(genderLabel),
        escapeCSV(u.city || ""),
        escapeCSV(countryName),
        escapeCSV(u.clubName || "Independiente"),
        escapeCSV(u.role),
        escapeCSV(u.plan),
        escapeCSV(bowType),
        escapeCSV(bowBrand),
        escapeCSV(bowModel),
        escapeCSV(poundage),
        escapeCSV(distance),
        escapeCSV(height),
        escapeCSV(weight),
        escapeCSV(domEye),
        escapeCSV(domHand),
        escapeCSV(regDate)
      ].join(",");
    });

    // Prepend UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility with special characters
    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const today = getLocalISODate();
    await downloadOrShareFile({
      filename: `suscriptores_demografia_archery101010_${today}.csv`,
      mimeType: "text/csv;charset=utf-8",
      data: csvContent,
      shareTitle: "Suscriptores ARCHERY 101010"
    });
  };

  const handleTogglePlan = async (targetUid: string) => {
    const userToUpdate = users.find((u) => u.uid === targetUid);
    if (!userToUpdate) return;

    try {
      const { updateProfile } = await import("@/lib/authService");
      const now = Date.now();
      const nextPlan: "FREE" | "PRO" = userToUpdate.plan === "FREE" ? "PRO" : "FREE";
      const proExpiresAt = nextPlan === "PRO" ? now + 365 * 24 * 60 * 60 * 1000 : 0;

      const updatedProfile = await updateProfile(targetUid, {
        plan: nextPlan,
        proExpiresAt
      });

      const auditEntry = {
        id: generateResilientId("SUB"),
        userId: targetUid,
        email: userToUpdate.email || "",
        plan: nextPlan,
        sku: nextPlan === "PRO" ? "admin_manual_pro_annual" : "admin_manual_free_revoke",
        source: "superadmin_users_tab",
        activatedAt: now,
        expiresAt: proExpiresAt,
        updatedAt: now
      };
      const localLogs = await getLocalSetting<any[]>("sub_audit_logs", []);
      await saveLocalSetting("sub_audit_logs", [auditEntry, ...localLogs]);

      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          const { doc, updateDoc, setDoc } = await import("firebase/firestore");
          const { db, auth } = await import("@/lib/firebase");
          if (auth.currentUser) {
            await updateDoc(doc(db, "users", targetUid), {
              plan: nextPlan,
              proExpiresAt,
              updatedAt: now
            });
            await setDoc(doc(db, "subscription_audit_logs", auditEntry.id), auditEntry, {
              merge: true
            });
          }
        } catch (cloudErr) {
          console.warn("[Admin Users] Could not sync plan toggle directly to Firestore:", cloudErr);
        }
      }

      setUsers((prev) => prev.map((u) => (u.uid === targetUid ? updatedProfile : u)));
      setSelectedUser((prev) => (prev?.uid === targetUid ? updatedProfile : prev));
      setSyncMessage(`Plan actualizado a ${nextPlan} para ${userToUpdate.fullName}`);
      setTimeout(() => setSyncMessage(null), 3500);
    } catch (err) {
      console.error("Error toggling plan:", err);
    }
  };

  const handleToggleRole = async (uid: string) => {
    const userToUpdate = users.find((u) => u.uid === uid);
    if (!userToUpdate) return;

    try {
      const { updateProfile } = await import("@/lib/authService");
      const roles: UserProfile["role"][] = ["archer", "coach", "team_admin", "superadmin"];
      const currentIndex = roles.indexOf(userToUpdate.role);
      const nextIndex = (currentIndex + 1) % roles.length;
      const newRole = roles[nextIndex];
      const now = Date.now();

      const updatedProfile = await updateProfile(uid, { role: newRole });
      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          const { doc, updateDoc } = await import("firebase/firestore");
          const { db, auth } = await import("@/lib/firebase");
          if (auth.currentUser) {
            await updateDoc(doc(db, "users", uid), {
              role: newRole,
              updatedAt: now
            });
          }
        } catch (cloudErr) {
          console.warn("[Admin Users] Could not sync role toggle directly to Firestore:", cloudErr);
        }
      }
      setUsers((prev) => prev.map((u) => (u.uid === uid ? updatedProfile : u)));
      setSelectedUser((prev) => (prev?.uid === uid ? updatedProfile : prev));
    } catch (err) {
      console.error("Error toggling role:", err);
    }
  };

  const filteredUsers = users.filter((u) => {
    const term = (searchTerm || "").toLowerCase().trim();
    const cleanNickTerm = term.replace(/^@/, "");
    const matchesSearch = 
      !term ||
      (u.fullName || "").toLowerCase().includes(term) ||
      (u.email || "").toLowerCase().includes(term) ||
      (u.nickname || "").toLowerCase().includes(cleanNickTerm) ||
      (u.uid || "").toLowerCase().includes(term) ||
      (u.clubInviteCode || "").toLowerCase().includes(term) ||
      (u.clubName || "").toLowerCase().includes(term) ||
      (u.city || "").toLowerCase().includes(term) ||
      (u.country || "").toLowerCase().includes(term);

    const matchesRole = 
      roleFilter === "ALL" || 
      (roleFilter === "COACH" && (u.role === "coach" || u.role === "team_admin_coach")) ||
      (roleFilter === "ARCHER" && u.role === "archer") ||
      (roleFilter === "ADMIN" && (u.role === "team_admin" || u.role === "superadmin"));

    const matchesPlan = 
      planFilter === "ALL" || 
      (planFilter === "PRO" && u.plan === "PRO") ||
      (planFilter === "FREE" && u.plan === "FREE");

    const matchesBow = 
      bowFilter === "ALL" ||
      u.bowConfig?.type === bowFilter;

    return matchesSearch && matchesRole && matchesPlan && matchesBow;
  });

  const getInitials = (name: string) => {
    if (!name) return "AR";
    return name
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  // KPIs (exact global Firestore server counts when available, fallback to loaded page)
  const localProCount = users.filter((u) => u.plan === "PRO").length;
  const localCoachCount = users.filter(
    (u) => u.role === "coach" || u.role === "team_admin" || u.role === "team_admin_coach"
  ).length;
  const totalCount = globalCounts ? Math.max(globalCounts.totalUsers, users.length) : users.length;
  const recentCount = users.filter(isRecentUser).length;
  const proCount = globalCounts ? Math.max(globalCounts.proUsers, localProCount) : localProCount;
  const coachCount = globalCounts ? Math.max(globalCounts.coachUsers, localCoachCount) : localCoachCount;

  return (
    <div className="flex flex-col gap-5 w-full p-4 md:p-6 pb-24">
      {/* Header section with Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] md:text-[26.4px] font-black text-white uppercase tracking-wider flex flex-wrap items-center gap-2">
            <span>Arqueros Inscritos</span>
            <span className="text-[15.8px] bg-cyan-neon/10 text-cyan-neon border border-cyan-neon/20 px-2.5 py-0.5 rounded-full font-black tabular-nums">
              {totalCount.toLocaleString()} Total
            </span>
          </h2>
          <p className="text-xs text-white">
            Monitoreo en tiempo real ({users.length.toLocaleString()} cargados en pantalla • búsqueda global en nube).
          </p>
        </div>

        {/* Action Buttons: Export & Refresh */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={refreshUsersFromFirestore}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 hover:border-white/20 text-white hover:text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
            title="Refrescar lista desde Firestore"
          >
            <RefreshCw size={13} className={isRefreshing ? "animate-spin text-cyan-neon" : ""} />
            <span>Actualizar</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="min-h-[38px] flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider active:scale-95 transition cursor-pointer"
            title="Descargar tabla en formato CSV"
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            <span>Exportar Tabla CSV</span>
          </button>
        </div>
      </div>

      {/* Sync Status Banner */}
      {syncMessage && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-cyan-neon/10 border border-cyan-neon/30 text-cyan-neon px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-cyan-neon animate-pulse" />
          <span>{syncMessage}</span>
        </motion.div>
      )}

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col">
          <span className="text-[11.6px] text-white uppercase font-bold flex items-center gap-1">
            <UserCheck size={12} className="text-cyan-neon" />
            Total Registrados
          </span>
          <span className="text-xl font-black text-white mt-1 tabular-nums">{totalCount.toLocaleString()}</span>
        </div>

        <div className="bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col">
          <span className="text-[11.6px] text-white uppercase font-bold flex items-center gap-1">
            <Flame size={12} className="text-yellow-gold" />
            Nuevos (48h)
          </span>
          <span className="text-xl font-black text-yellow-gold mt-1 flex items-center gap-1.5 tabular-nums">
            {recentCount}
            {recentCount > 0 && (
              <span className="text-[10.5px] px-1.5 py-0.2 rounded-full bg-orange-500/20 text-yellow-gold font-bold uppercase">
                Reciente
              </span>
            )}
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col">
          <span className="text-[11.6px] text-white uppercase font-bold flex items-center gap-1">
            <Crown size={12} className="text-yellow-gold" />
            Suscripciones PRO
          </span>
          <span className="text-xl font-black text-yellow-gold mt-1 tabular-nums">{proCount.toLocaleString()}</span>
        </div>

        <div className="bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col">
          <span className="text-[11.6px] text-white uppercase font-bold flex items-center gap-1">
            <Shield size={12} className="text-cyan-neon" />
            Coaches / Clubes
          </span>
          <span className="text-xl font-black text-cyan-neon mt-1 tabular-nums">{coachCount.toLocaleString()}</span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-center sticky top-0 z-10 bg-[#0A0A0C]/95 backdrop-blur-md py-2 border-b border-white/5">
        <div className="w-full md:flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white" size={16} />
          <input
            type="text"
            placeholder="Buscar en toda la nube por nombre, @apodo, correo, ID o código..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-neutral-900/50 border border-white/10 text-white text-xs outline-none focus:border-cyan-neon focus:bg-neutral-900 transition duration-200"
          />
          {isSearchingCloud && (
            <Loader2
              size={14}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-cyan-neon animate-spin"
              aria-label="Buscando en la nube"
            />
          )}
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap gap-2 w-full md:w-auto max-w-full">
          {/* Roles Filter */}
          <div className="flex max-w-full overflow-x-auto scrollbar-none bg-neutral-900/50 border border-white/10 rounded-xl p-0.5">
            {["ALL", "ARCHER", "COACH", "ADMIN"].map((filter) => (
              <button
                key={filter}
                onClick={() => setRoleFilter(filter)}
                className={`px-2.5 sm:px-3 py-1 rounded-lg text-[12.6px] sm:text-[13.2px] font-bold uppercase whitespace-nowrap shrink-0 transition cursor-pointer ${
                  roleFilter === filter
                    ? "bg-white/10 text-white"
                    : "text-white hover:text-white"
                }`}
              >
                {filter === "ALL" ? "Todos" : filter === "ARCHER" ? "Arqueros" : filter === "COACH" ? "Coaches" : "Admins"}
              </button>
            ))}
          </div>

          {/* Plan Filter */}
          <div className="flex max-w-full overflow-x-auto scrollbar-none bg-neutral-900/50 border border-white/10 rounded-xl p-0.5">
            {["ALL", "FREE", "PRO"].map((filter) => (
              <button
                key={filter}
                onClick={() => setPlanFilter(filter)}
                className={`px-2.5 sm:px-3 py-1 rounded-lg text-[12.6px] sm:text-[13.2px] font-bold uppercase whitespace-nowrap shrink-0 transition cursor-pointer ${
                  planFilter === filter
                    ? "bg-white/10 text-white"
                    : "text-white hover:text-white"
                }`}
              >
                {filter === "ALL" ? "Planes" : filter}
              </button>
            ))}
          </div>

          {/* Bow Filter */}
          <div className="flex max-w-full overflow-x-auto scrollbar-none bg-neutral-900/50 border border-white/10 rounded-xl p-0.5">
            {[
              { id: "ALL", label: "Arcos" },
              { id: "Recurve", label: "Recurvo" },
              { id: "Compound", label: "Compuesto" },
              { id: "Barebow", label: "Raso" }
            ].map((b) => (
              <button
                key={b.id}
                onClick={() => setBowFilter(b.id)}
                className={`px-2 sm:px-2.5 py-1 rounded-lg text-[12.6px] sm:text-[13.2px] font-bold uppercase whitespace-nowrap shrink-0 transition cursor-pointer ${
                  bowFilter === b.id
                    ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/20"
                    : "text-white hover:text-white"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Users view list */}
      <div className="w-full flex flex-col gap-3">
        {filteredUsers.length === 0 ? (
          <div className="bg-neutral-900/20 border border-white/5 rounded-3xl p-12 text-center text-white text-xs">
            No se encontraron arqueros que coincidan con los filtros de búsqueda.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filteredUsers.map((u) => {
              const countryInfo =
                COUNTRIES_MAP[u.country] ||
                COUNTRIES.find((c) => c.code === u.country) || {
                  flag: u.country || "INT",
                  name: u.country || "Desconocido"
                };
              const isRecent = isRecentUser(u);

              return (
                <motion.div
                  layoutId={`user-row-${u.uid}`}
                  key={u.uid}
                  className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-white/20 transition-all duration-200 shadow-lg relative"
                >
                  {/* Left: Archer Identity, Flag, Country & Nickname */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/20 flex items-center justify-center text-cyan-neon font-black text-sm">
                        {getInitials(u.fullName)}
                      </div>
                      <span className="absolute -bottom-1 -right-1 text-sm drop-shadow-md">
                        {countryInfo.flag}
                      </span>
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="text-xs font-bold text-white truncate">{u.fullName}</h4>
                        {u.nickname && (
                          <span className="text-[11.6px] text-cyan-neon tabular-nums font-semibold">
                            @{u.nickname}
                          </span>
                        )}
                        {isRecent && (
                          <span className="text-[9.3px] px-1.5 py-0.2 rounded-full bg-cyan-neon/20 text-cyan-neon font-black uppercase tracking-wider animate-pulse">
                            Nuevo
                          </span>
                        )}
                      </div>

                      <p className="text-[11.6px] text-white truncate">{u.email}</p>

                      {/* Sub-row: Demographics, Club & Primary Bow */}
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-white flex-wrap">
                        <span className="text-yellow-gold font-bold tabular-nums">
                          {calculateAge(u.birthDate) !== null ? `${calculateAge(u.birthDate)} años` : "Edad N/D"}
                        </span>
                        <span>·</span>
                        <span className="text-white font-medium">
                          {u.gender === "M" ? "M" : u.gender === "F" ? "F" : "O"}
                        </span>
                        <span>·</span>
                        <span className="text-white font-medium">
                          {u.city ? `${u.city}, ` : ""}{countryInfo.name}
                        </span>
                        <span>·</span>
                        <span className="text-white font-semibold">{u.clubName || "Independiente"}</span>
                        <span>·</span>
                        <span className="text-cyan-neon font-medium">
                          {u.bowConfig?.type || "Barebow"} {u.bowConfig?.poundage ? `(${u.bowConfig.poundage}#)` : ""}
                        </span>
                        <span>·</span>
                        <span className="text-white flex items-center gap-1">
                          <Calendar size={10} />
                          {formatRegistrationDate(u.createdAt || u.lastActiveAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Badges and Action Controls */}
                  <div className="flex items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t border-white/5 md:border-t-0 shrink-0">
                    {/* Role badge */}
                    <span className={`text-[10.5px] px-2 py-0.5 rounded-full font-bold uppercase border ${
                      u.role === "superadmin" 
                        ? "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20"
                        : u.role === "coach" || u.role === "team_admin_coach"
                        ? "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20"
                        : "bg-neutral-500/10 text-white border-neutral-500/20"
                    }`}>
                      {u.role === "archer" ? "Atleta" : u.role}
                    </span>

                    {/* Plan badge */}
                    <span className={`text-[10.5px] px-2.5 py-0.5 rounded-full font-black border uppercase ${
                      u.plan === "PRO"
                        ? "bg-yellow-gold/10 text-yellow-gold border-yellow-gold/25"
                        : "bg-white/5 text-white border-white/5"
                    }`}>
                      {u.plan}
                    </span>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 ml-1">
                      <button
                        type="button"
                        onClick={() => setSelectedUser(u)}
                        aria-label={`Ver ficha completa de ${u.fullName}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-white transition cursor-pointer"
                        title="Ver Ficha Completa"
                      >
                        <Eye size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleRole(u.uid)}
                        aria-label={`Cambiar rol de ${u.fullName}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-cyan-neon transition cursor-pointer"
                        title="Cambiar Rol (Atleta / Coach / Admin)"
                      >
                        <Shield size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTogglePlan(u.uid)}
                        aria-label={`Alternar plan de ${u.fullName}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-yellow-gold transition cursor-pointer"
                        title="Alternar Plan (FREE / PRO)"
                      >
                        <Crown size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Cursor Pagination Button (50 per page) */}
        {hasMoreUsers && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={handleLoadMoreUsers}
              disabled={isLoadingMore}
              className="min-h-[42px] px-5 py-2.5 rounded-2xl bg-[#0D1017] hover:bg-neutral-900 border border-white/15 hover:border-cyan-neon/40 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {isLoadingMore ? (
                <>
                  <Loader2 size={14} className="animate-spin text-cyan-neon" />
                  <span>Cargando siguientes 50...</span>
                </>
              ) : (
                <>
                  <ChevronDown size={15} className="text-cyan-neon" />
                  <span className="tabular-nums">
                    Cargar 50 más ({users.length.toLocaleString()} de {totalCount.toLocaleString()})
                  </span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* User Details Modal */}
      <AnimatePresence>
        {selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setSelectedUser(null)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-neutral-900 border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            >
              {/* Profile Header */}
              <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/20 flex items-center justify-center text-cyan-neon font-black text-lg">
                    {getInitials(selectedUser.fullName)}
                  </div>
                  <span className="absolute -bottom-1 -right-1 text-[10.5px] font-black uppercase bg-neutral-950 border border-white/15 text-cyan-neon px-1 py-0.5 rounded leading-none">
                    {COUNTRIES_MAP[selectedUser.country]?.flag || selectedUser.country || "INT"}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold text-white truncate">{selectedUser.fullName}</h3>
                    {selectedUser.nickname && (
                      <span className="text-[12.8px] text-cyan-neon tabular-nums font-semibold">
                        @{selectedUser.nickname}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white flex items-center gap-1 mt-0.5 truncate">
                    <Mail size={12} />
                    <span>{selectedUser.email}</span>
                  </p>
                  <p className="text-[11.6px] text-cyan-neon mt-1">
                    Inscripción: {formatRegistrationDate(selectedUser.createdAt || selectedUser.lastActiveAt)}
                  </p>
                </div>
              </div>

              {/* Profile Data Info */}
              <div className="flex flex-col gap-3 text-xs">
                <div className="grid grid-cols-2 gap-2.5 bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5">
                  <div>
                    <span className="text-[10.5px] text-white uppercase font-black tracking-widest block">País / Ciudad</span>
                    <span className="text-white font-medium">
                      {COUNTRIES_MAP[selectedUser.country]?.flag} {selectedUser.city ? `${selectedUser.city}, ` : ""}{COUNTRIES_MAP[selectedUser.country]?.name || selectedUser.country || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-white uppercase font-black tracking-widest block">Género</span>
                    <span className="text-white font-medium">
                      {selectedUser.gender === "M" ? "Masculino" : selectedUser.gender === "F" ? "Femenino" : selectedUser.gender || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-white uppercase font-black tracking-widest block">Edad / Nacimiento</span>
                    <span className="text-yellow-gold font-bold tabular-nums">
                      {calculateAge(selectedUser.birthDate) !== null
                        ? `${calculateAge(selectedUser.birthDate)} años (${getWACategory(calculateAge(selectedUser.birthDate))})`
                        : "N/A"}
                    </span>
                    <span className="text-white text-[10.5px] block tabular-nums">{selectedUser.birthDate || ""}</span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-white uppercase font-black tracking-widest block">ID Usuario</span>
                    <span className="text-white tabular-nums text-[10.5px] truncate block">{selectedUser.uid}</span>
                  </div>
                </div>

                <div className="bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-2">
                  <h4 className="font-bold text-white text-[11.6px] uppercase tracking-wider text-cyan-neon flex items-center gap-1.5">
                    <Target size={12} />
                    Configuración de Arco Principal
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10.5px] text-white uppercase font-bold block">Tipo</span>
                      <span className="text-white font-medium">{selectedUser.bowConfig?.type || "Barebow"}</span>
                    </div>
                    <div>
                      <span className="text-[10.5px] text-white uppercase font-bold block">Marca / Modelo</span>
                      <span className="text-white font-medium truncate">
                        {selectedUser.bowConfig?.brand || ""} {selectedUser.bowConfig?.model || ""}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10.5px] text-white uppercase font-bold block">Potencia</span>
                      <span className="text-white font-medium tabular-nums">{selectedUser.bowConfig?.poundage || 0} lbs</span>
                    </div>
                    <div>
                      <span className="text-[10.5px] text-white uppercase font-bold block">Distancia Default</span>
                      <span className="text-white font-medium tabular-nums">{selectedUser.bowConfig?.defaultDistance || 18}m</span>
                    </div>
                  </div>
                </div>

                <div className="bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-1.5">
                  <h4 className="font-bold text-white text-[11.6px] uppercase tracking-wider text-cyan-neon">
                    Club y Contacto
                  </h4>
                  <div className="grid grid-cols-2 gap-1.5">
                    <span className="text-white">Club Deportivo:</span>
                    <span className="text-white font-bold text-right truncate">
                      {selectedUser.clubName || "Arquero Independiente"}
                    </span>
                    <span className="text-white">ID Club:</span>
                    <span className="text-white font-bold text-right truncate text-[11.6px]">
                      {selectedUser.clubId || "Ninguno"}
                    </span>

                    <span className="text-white">Teléfono / Mensajería:</span>
                    <span className="text-white font-bold text-right truncate">
                      {selectedUser.whatsappNumber || "No indicado"}
                    </span>

                    <span className="text-white">Rol en la App:</span>
                    <span className="text-cyan-neon font-bold text-right uppercase text-[11.6px]">
                      {selectedUser.role}
                    </span>
                  </div>
                </div>
              </div>

              {/* Close Action */}
              <button
                onClick={() => setSelectedUser(null)}
                className="w-full py-2.5 mt-2 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase transition cursor-pointer"
              >
                Cerrar Detalles
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
