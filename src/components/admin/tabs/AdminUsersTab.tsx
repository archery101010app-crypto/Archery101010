"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  Target
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";

const COUNTRIES: Record<string, { name: string; flag: string }> = {
  CR: { name: "Costa Rica", flag: "CRC" },
  ES: { name: "España", flag: "ESP" },
  MX: { name: "México", flag: "MEX" },
  CO: { name: "Colombia", flag: "COL" },
  AR: { name: "Argentina", flag: "ARG" },
  US: { name: "Estados Unidos", flag: "USA" },
  CL: { name: "Chile", flag: "CHI" },
  PE: { name: "Perú", flag: "PER" },
  GT: { name: "Guatemala", flag: "GUA" },
  PA: { name: "Panamá", flag: "PAN" },
  BR: { name: "Brasil", flag: "BRA" },
};

export default function AdminUsersTab() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [planFilter, setPlanFilter] = useState<string>("ALL");
  const [bowFilter, setBowFilter] = useState<string>("ALL");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Helper to format timestamps gracefully
  const formatRegistrationDate = (timestamp?: number | string) => {
    if (!timestamp) return "Fecha no registrada";
    const num = typeof timestamp === "string" ? parseInt(timestamp, 10) : timestamp;
    if (isNaN(num)) return "Fecha no registrada";
    const date = new Date(num);
    if (isNaN(date.getTime())) return "Fecha no registrada";
    return date.toLocaleDateString("es-ES", {
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

  // Fetch from Firestore collection "users" and merge
  const refreshUsersFromFirestore = useCallback(async () => {
    setIsRefreshing(true);
    setSyncMessage("Sincronizando con Firestore...");
    try {
      const localList = await loadLocalUsers();

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { collection, getDocs } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");

        const querySnapshot = await getDocs(collection(db, "users"));
        const remoteUsers: UserProfile[] = [];

        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data() as UserProfile;
          if (data && (data.uid || data.email)) {
            remoteUsers.push(data);
          }
        });

        if (remoteUsers.length > 0) {
          // Merge remote users with local users, remote taking precedence
          const mergedMap = new Map<string, UserProfile>();
          
          // Seed with local list
          localList.forEach((u) => {
            const key = u.uid || (u.email || "").toLowerCase();
            mergedMap.set(key, u);
          });

          // Overwrite/insert with remote users
          remoteUsers.forEach((u) => {
            const key = u.uid || (u.email || "").toLowerCase();
            const existing = mergedMap.get(key);
            mergedMap.set(key, { ...existing, ...u });
          });

          const finalList = Array.from(mergedMap.values());
          // Sort by registration date descending (newest first)
          finalList.sort((a, b) => {
            const timeA = a.createdAt || a.lastActiveAt || 0;
            const timeB = b.createdAt || b.lastActiveAt || 0;
            return timeB - timeA;
          });

          setUsers(finalList);
          await saveLocalSetting("simulated_users", finalList);
          setSyncMessage(`✓ ${finalList.length} arqueros sincronizados`);
        } else {
          setSyncMessage(`✓ ${localList.length} arqueros locales cargados`);
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

  // Export users to CSV / Excel
  const handleExportCSV = () => {
    if (users.length === 0) {
      alert("No hay usuarios para exportar.");
      return;
    }

    const headers = [
      "ID",
      "Nombre Completo",
      "Alias / Gamertag",
      "Correo",
      "País",
      "Club",
      "Rol",
      "Plan",
      "Tipo de Arco",
      "Marca Arco",
      "Modelo Arco",
      "Potencia (lbs)",
      "Distancia Default (m)",
      "Fecha de Registro"
    ];

    const escapeCSV = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = users.map((u) => {
      const countryName = COUNTRIES[u.country]?.name || u.country || "N/A";
      const bowType = u.bowConfig?.type || "Barebow";
      const bowBrand = u.bowConfig?.brand || "";
      const bowModel = u.bowConfig?.model || "";
      const poundage = u.bowConfig?.poundage || "";
      const distance = u.bowConfig?.defaultDistance || "";
      const regDate = formatRegistrationDate(u.createdAt || u.lastActiveAt);

      return [
        escapeCSV(u.uid),
        escapeCSV(u.fullName),
        escapeCSV(u.nickname ? `@${u.nickname}` : ""),
        escapeCSV(u.email),
        escapeCSV(countryName),
        escapeCSV(u.clubName || "Independiente"),
        escapeCSV(u.role),
        escapeCSV(u.plan),
        escapeCSV(bowType),
        escapeCSV(bowBrand),
        escapeCSV(bowModel),
        escapeCSV(poundage),
        escapeCSV(distance),
        escapeCSV(regDate)
      ].join(",");
    });

    // Prepend UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility with special characters
    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = new Date().toISOString().split("T")[0];
    link.setAttribute("href", url);
    link.setAttribute("download", `arqueros_inscritos_archery101010_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleTogglePlan = async (uid: string) => {
    const userToUpdate = users.find((u) => u.uid === uid);
    if (!userToUpdate) return;

    try {
      const { updateProfile } = await import("@/lib/authService");
      const newPlan = userToUpdate.plan === "FREE" ? "PRO" : "FREE";
      const updatedProfile = await updateProfile(uid, { plan: newPlan });
      setUsers(users.map((u) => (u.uid === uid ? updatedProfile : u)));
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

      const updatedProfile = await updateProfile(uid, { role: newRole });
      setUsers(users.map((u) => (u.uid === uid ? updatedProfile : u)));
    } catch (err) {
      console.error("Error toggling role:", err);
    }
  };

  const filteredUsers = users.filter((u) => {
    const term = (searchTerm || "").toLowerCase();
    const matchesSearch = 
      (u.fullName || "").toLowerCase().includes(term) ||
      (u.email || "").toLowerCase().includes(term) ||
      (u.nickname || "").toLowerCase().includes(term) ||
      (u.clubName || "").toLowerCase().includes(term) ||
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

  // KPIs
  const totalCount = users.length;
  const recentCount = users.filter(isRecentUser).length;
  const proCount = users.filter((u) => u.plan === "PRO").length;
  const coachCount = users.filter((u) => u.role === "coach" || u.role === "team_admin_coach").length;

  return (
    <div className="flex flex-col gap-5 w-full p-4 md:p-6 pb-24">
      {/* Header section with Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wider flex items-center gap-2">
            <span>Arqueros Inscritos</span>
            <span className="text-xs bg-cyan-neon/10 text-cyan-neon border border-cyan-neon/20 px-2.5 py-0.5 rounded-full font-black">
              {totalCount} Total
            </span>
          </h2>
          <p className="text-xs text-white/50">
            Monitoreo en tiempo real de nuevos registros y base deportiva.
          </p>
        </div>

        {/* Action Buttons: Export & Refresh */}
        <div className="flex items-center gap-2">
          <button
            onClick={refreshUsersFromFirestore}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 hover:border-white/20 text-white/80 hover:text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
            title="Refrescar lista desde Firestore"
          >
            <RefreshCw size={13} className={isRefreshing ? "animate-spin text-cyan-neon" : ""} />
            <span>Actualizar</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-black text-xs uppercase tracking-wider shadow-glow-cyan hover:brightness-110 active:scale-95 transition cursor-pointer"
            title="Descargar tabla en formato Excel / CSV"
          >
            <FileSpreadsheet size={14} />
            <span>Exportar Excel / CSV</span>
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
          <span className="text-[10px] text-gray-dim uppercase font-bold flex items-center gap-1">
            <UserCheck size={12} className="text-cyan-neon" />
            Total Registrados
          </span>
          <span className="text-xl font-black text-white mt-1">{totalCount}</span>
        </div>

        <div className="bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col">
          <span className="text-[10px] text-gray-dim uppercase font-bold flex items-center gap-1">
            <Flame size={12} className="text-orange-400" />
            Nuevos (48h)
          </span>
          <span className="text-xl font-black text-orange-400 mt-1 flex items-center gap-1.5">
            {recentCount}
            {recentCount > 0 && (
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-orange-500/20 text-orange-300 font-bold uppercase">
                Reciente
              </span>
            )}
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col">
          <span className="text-[10px] text-gray-dim uppercase font-bold flex items-center gap-1">
            <Sparkles size={12} className="text-yellow-gold" />
            Suscripciones PRO
          </span>
          <span className="text-xl font-black text-yellow-gold mt-1">{proCount}</span>
        </div>

        <div className="bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col">
          <span className="text-[10px] text-gray-dim uppercase font-bold flex items-center gap-1">
            <Shield size={12} className="text-purple-400" />
            Coaches / Clubes
          </span>
          <span className="text-xl font-black text-purple-400 mt-1">{coachCount}</span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-center sticky top-0 z-10 bg-[#0A0A0C]/95 backdrop-blur-md py-2 border-b border-white/5">
        <div className="w-full md:flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" size={16} />
          <input
            type="text"
            placeholder="Buscar por nombre, @apodo, correo, país o club..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-neutral-900/50 border border-white/10 text-white text-xs outline-none focus:border-cyan-neon focus:bg-neutral-900 transition duration-200"
          />
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {/* Roles Filter */}
          <div className="flex bg-neutral-900/50 border border-white/10 rounded-xl p-0.5 overflow-hidden">
            {["ALL", "ARCHER", "COACH", "ADMIN"].map((filter) => (
              <button
                key={filter}
                onClick={() => setRoleFilter(filter)}
                className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition cursor-pointer ${
                  roleFilter === filter
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {filter === "ALL" ? "Todos" : filter === "ARCHER" ? "Arqueros" : filter === "COACH" ? "Coaches" : "Admins"}
              </button>
            ))}
          </div>

          {/* Plan Filter */}
          <div className="flex bg-neutral-900/50 border border-white/10 rounded-xl p-0.5 overflow-hidden">
            {["ALL", "FREE", "PRO"].map((filter) => (
              <button
                key={filter}
                onClick={() => setPlanFilter(filter)}
                className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition cursor-pointer ${
                  planFilter === filter
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {filter === "ALL" ? "Planes" : filter}
              </button>
            ))}
          </div>

          {/* Bow Filter */}
          <div className="flex bg-neutral-900/50 border border-white/10 rounded-xl p-0.5 overflow-hidden">
            {[
              { id: "ALL", label: "Arcos" },
              { id: "Recurve", label: "Recurvo" },
              { id: "Compound", label: "Compuesto" },
              { id: "Barebow", label: "Raso" }
            ].map((b) => (
              <button
                key={b.id}
                onClick={() => setBowFilter(b.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition cursor-pointer ${
                  bowFilter === b.id
                    ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/20"
                    : "text-white/40 hover:text-white/70"
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
          <div className="bg-neutral-900/20 border border-white/5 rounded-3xl p-12 text-center text-white/30 text-xs">
            No se encontraron arqueros que coincidan con los filtros de búsqueda.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filteredUsers.map((u) => {
              const countryInfo = COUNTRIES[u.country] || { flag: u.country || "INT", name: u.country || "Desconocido" };
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
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-brand/20 to-cyan-neon/30 border border-cyan-neon/20 flex items-center justify-center text-cyan-neon font-black text-sm">
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
                          <span className="text-[10px] text-purple-400 font-mono font-semibold">
                            @{u.nickname}
                          </span>
                        )}
                        {isRecent && (
                          <span className="text-[8px] px-1.5 py-0.2 rounded-full bg-cyan-neon/20 text-cyan-neon font-black uppercase tracking-wider animate-pulse">
                            Nuevo
                          </span>
                        )}
                      </div>

                      <p className="text-[10px] text-white/40 truncate">{u.email}</p>

                      {/* Sub-row: Club & Primary Bow */}
                      <div className="flex items-center gap-2 mt-1 text-[9.5px] text-gray-dim flex-wrap">
                        <span className="text-white/70 font-semibold">{u.clubName || "Independiente"}</span>
                        <span>·</span>
                        <span className="text-cyan-neon font-medium">
                          {u.bowConfig?.type || "Barebow"} {u.bowConfig?.poundage ? `(${u.bowConfig.poundage}#)` : ""}
                        </span>
                        <span>·</span>
                        <span className="text-white/40 flex items-center gap-1">
                          <Calendar size={10} />
                          {formatRegistrationDate(u.createdAt || u.lastActiveAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Badges and Action Controls */}
                  <div className="flex items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t border-white/5 md:border-t-0 shrink-0">
                    {/* Role badge */}
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border ${
                      u.role === "superadmin" 
                        ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                        : u.role === "coach" || u.role === "team_admin_coach"
                        ? "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20"
                        : "bg-neutral-500/10 text-neutral-400 border-neutral-500/20"
                    }`}>
                      {u.role === "archer" ? "Atleta" : u.role}
                    </span>

                    {/* Plan badge */}
                    <span className={`text-[9px] px-2.5 py-0.5 rounded-full font-black border uppercase ${
                      u.plan === "PRO"
                        ? "bg-yellow-gold/10 text-yellow-gold border-yellow-gold/20 shadow-[0_0_10px_rgba(255,229,0,0.05)]"
                        : "bg-white/5 text-white/50 border-white/5"
                    }`}>
                      {u.plan}
                    </span>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 ml-1">
                      <button
                        onClick={() => setSelectedUser(u)}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer"
                        title="Ver Ficha Completa"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        onClick={() => handleToggleRole(u.uid)}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-neon/80 hover:text-cyan-neon transition cursor-pointer"
                        title="Cambiar Rol (Atleta / Coach / Admin)"
                      >
                        <Shield size={13} />
                      </button>
                      <button
                        onClick={() => handleTogglePlan(u.uid)}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-yellow-gold/80 hover:text-yellow-gold transition cursor-pointer"
                        title="Alternar Plan (FREE / PRO)"
                      >
                        <Sparkles size={13} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
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
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-brand/20 to-cyan-neon/30 border border-cyan-neon/20 flex items-center justify-center text-cyan-neon font-black text-lg">
                    {getInitials(selectedUser.fullName)}
                  </div>
                  <span className="absolute -bottom-1 -right-1 text-[9px] font-black uppercase bg-neutral-950 border border-white/15 text-cyan-neon px-1 py-0.5 rounded leading-none">
                    {COUNTRIES[selectedUser.country]?.flag || selectedUser.country || "INT"}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold text-white truncate">{selectedUser.fullName}</h3>
                    {selectedUser.nickname && (
                      <span className="text-[11px] text-purple-400 font-mono font-semibold">
                        @{selectedUser.nickname}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/40 flex items-center gap-1 mt-0.5 truncate">
                    <Mail size={12} />
                    <span>{selectedUser.email}</span>
                  </p>
                  <p className="text-[10px] text-cyan-neon mt-1">
                    Inscripción: {formatRegistrationDate(selectedUser.createdAt || selectedUser.lastActiveAt)}
                  </p>
                </div>
              </div>

              {/* Profile Data Info */}
              <div className="flex flex-col gap-3 text-xs">
                <div className="grid grid-cols-2 gap-2 bg-neutral-950/40 p-3 rounded-2xl border border-white/5">
                  <div>
                    <span className="text-[9px] text-white/30 uppercase font-black tracking-widest block">País</span>
                    <span className="text-white font-medium">
                      {COUNTRIES[selectedUser.country]?.flag} {COUNTRIES[selectedUser.country]?.name || selectedUser.country || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] text-white/30 uppercase font-black tracking-widest block">Género</span>
                    <span className="text-white font-medium">
                      {selectedUser.gender === "M" ? "Masculino" : selectedUser.gender === "F" ? "Femenino" : selectedUser.gender || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] text-white/30 uppercase font-black tracking-widest block">Nacimiento</span>
                    <span className="text-white font-medium">{selectedUser.birthDate || "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-white/30 uppercase font-black tracking-widest block">ID Usuario</span>
                    <span className="text-white font-mono text-[9px] truncate block">{selectedUser.uid}</span>
                  </div>
                </div>

                <div className="bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-2">
                  <h4 className="font-bold text-white text-[10px] uppercase tracking-wider text-cyan-neon flex items-center gap-1.5">
                    <Target size={12} />
                    Configuración de Arco Principal
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[9px] text-white/30 uppercase font-bold block">Tipo</span>
                      <span className="text-white font-medium">{selectedUser.bowConfig?.type || "Barebow"}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-white/30 uppercase font-bold block">Marca / Modelo</span>
                      <span className="text-white font-medium truncate">
                        {selectedUser.bowConfig?.brand || ""} {selectedUser.bowConfig?.model || ""}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-white/30 uppercase font-bold block">Potencia</span>
                      <span className="text-white font-medium">{selectedUser.bowConfig?.poundage || 0} lbs</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-white/30 uppercase font-bold block">Distancia Default</span>
                      <span className="text-white font-medium">{selectedUser.bowConfig?.defaultDistance || 18}m</span>
                    </div>
                  </div>
                </div>

                <div className="bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-1.5">
                  <h4 className="font-bold text-white text-[10px] uppercase tracking-wider text-cyan-neon">
                    Club y Contacto
                  </h4>
                  <div className="grid grid-cols-2 gap-1.5">
                    <span className="text-white/60">Club Deportivo:</span>
                    <span className="text-white font-bold text-right truncate">
                      {selectedUser.clubName || "Arquero Independiente"}
                    </span>

                    <span className="text-white/60">ID Club:</span>
                    <span className="text-white font-bold text-right truncate text-[10px]">
                      {selectedUser.clubId || "Ninguno"}
                    </span>

                    <span className="text-white/60">Teléfono / WhatsApp:</span>
                    <span className="text-white font-bold text-right truncate">
                      {selectedUser.whatsappNumber || "No indicado"}
                    </span>

                    <span className="text-white/60">Rol en la App:</span>
                    <span className="text-cyan-neon font-bold text-right uppercase text-[10px]">
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
