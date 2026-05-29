"use client";

import React, { useState, useEffect } from "react";
import { Search, Eye, ShieldAlert, Sparkles, User, Mail, Shield, Award, Ban } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";

export default function AdminUsersTab() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [planFilter, setPlanFilter] = useState<string>("ALL");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    async function loadUsers() {
      const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
      setUsers(list);
    }
    loadUsers();

    const handleDbChange = (e: any) => {
      if (e.detail?.store === "simulated_users") {
        loadUsers();
      }
    };

    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, []);

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
      const roles: ("archer" | "coach" | "admin" | "superadmin")[] = ["archer", "coach", "admin", "superadmin"];
      const currentIndex = roles.indexOf(userToUpdate.role as any);
      const nextIndex = (currentIndex + 1) % roles.length;
      const newRole = roles[nextIndex];

      const updatedProfile = await updateProfile(uid, { role: newRole });
      setUsers(users.map((u) => (u.uid === uid ? updatedProfile : u)));
    } catch (err) {
      console.error("Error toggling role:", err);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch = 
      u.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.clubName || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRole = 
      roleFilter === "ALL" || 
      (roleFilter === "COACH" && u.role === "coach") ||
      (roleFilter === "ARCHER" && u.role === "archer") ||
      (roleFilter === "ADMIN" && (u.role === "admin" || u.role === "superadmin"));

    const matchesPlan = 
      planFilter === "ALL" || 
      (planFilter === "PRO" && u.plan === "PRO") ||
      (planFilter === "FREE" && u.plan === "FREE");

    return matchesSearch && matchesRole && matchesPlan;
  });

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <div className="flex flex-col gap-5 w-full p-4 md:p-6">
      {/* Header section */}
      <div>
        <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wider">Gestión de Usuarios</h2>
        <p className="text-xs text-white/50">Administra roles, planes y visualiza perfiles de los miembros.</p>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-center sticky top-0 z-10 bg-[#0A0A0C] py-2">
        <div className="w-full md:flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" size={16} />
          <input
            type="text"
            placeholder="Buscar por nombre, email o club..."
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
                className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition ${
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
                className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition ${
                  planFilter === filter
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {filter === "ALL" ? "Todos" : filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Users view list */}
      <div className="w-full flex flex-col gap-3">
        {filteredUsers.length === 0 ? (
          <div className="bg-neutral-900/20 border border-white/5 rounded-3xl p-12 text-center text-white/30 text-xs">
            No se encontraron usuarios que coincidan con la búsqueda.
          </div>
        ) : (
          <>
            {/* Desktop Table Header */}
            <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-2.5 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">
              <div className="col-span-4">Usuario</div>
              <div className="col-span-3">Club</div>
              <div className="col-span-2">Rol</div>
              <div className="col-span-1.5 text-center">Plan</div>
              <div className="col-span-1.5 text-right">Acciones</div>
            </div>

            {/* List items */}
            <div className="flex flex-col gap-2.5">
              {filteredUsers.map((user) => (
                <motion.div
                  layoutId={`user-row-${user.uid}`}
                  key={user.uid}
                  className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl md:rounded-xl p-4 md:px-6 md:py-3.5 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 items-center hover:border-white/20 transition-all duration-200 shadow-lg relative"
                >
                  {/* User identity details */}
                  <div className="col-span-1 md:col-span-4 flex items-center gap-3">
                    {/* Initials Avatar */}
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-brand/20 to-cyan-neon/30 border border-cyan-neon/20 flex items-center justify-center text-cyan-neon font-black text-xs">
                      {getInitials(user.fullName)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">{user.fullName}</h4>
                      <p className="text-[10px] text-white/40 truncate">{user.email}</p>
                    </div>
                  </div>

                  {/* Club details */}
                  <div className="col-span-1 md:col-span-3 flex items-center text-xs text-white/60">
                    <span className="md:hidden text-[9px] font-bold text-white/30 uppercase mr-2">Club:</span>
                    <span className="truncate">{user.clubName || "Sin Club asignado"}</span>
                  </div>

                  {/* Role details */}
                  <div className="col-span-1 md:col-span-2 flex items-center">
                    <span className="md:hidden text-[9px] font-bold text-white/30 uppercase mr-2">Rol:</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                      user.role === "superadmin" 
                        ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                        : user.role === "coach"
                        ? "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20"
                        : "bg-neutral-500/10 text-neutral-400 border-neutral-500/20"
                    }`}>
                      {user.role}
                    </span>
                  </div>

                  {/* Plan details */}
                  <div className="col-span-1 md:col-span-1.5 flex md:justify-center items-center">
                    <span className="md:hidden text-[9px] font-bold text-white/30 uppercase mr-2">Plan:</span>
                    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-black border ${
                      user.plan === "PRO"
                        ? "bg-yellow-gold/10 text-yellow-gold border-yellow-gold/20 shadow-[0_0_10px_rgba(255,229,0,0.05)]"
                        : "bg-white/5 text-white/50 border-white/5"
                    }`}>
                      {user.plan}
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div className="col-span-1 md:col-span-1.5 flex justify-end items-center gap-1 mt-2 md:mt-0 pt-3 md:pt-0 border-t border-white/5 md:border-t-0">
                    <button
                      onClick={() => setSelectedUser(user)}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer"
                      title="Ver Detalles"
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      onClick={() => handleToggleRole(user.uid)}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-neon/80 hover:text-cyan-neon transition cursor-pointer"
                      title="Cambiar Rol"
                    >
                      <Shield size={13} />
                    </button>
                    <button
                      onClick={() => handleTogglePlan(user.uid)}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-yellow-gold/80 hover:text-yellow-gold transition cursor-pointer"
                      title="Cambiar Plan (FREE/PRO)"
                    >
                      <Sparkles size={13} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* User Details Modal */}
      <AnimatePresence>
        {selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setSelectedUser(null)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-neutral-900 border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl z-10 flex flex-col gap-4"
            >
              {/* Profile Header */}
              <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-brand/20 to-cyan-neon/30 border border-cyan-neon/20 flex items-center justify-center text-cyan-neon font-black text-lg">
                  {getInitials(selectedUser.fullName)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{selectedUser.fullName}</h3>
                  <p className="text-xs text-white/40 flex items-center gap-1 mt-0.5">
                    <Mail size={12} />
                    <span>{selectedUser.email}</span>
                  </p>
                </div>
              </div>

              {/* Profile Data Info */}
              <div className="flex flex-col gap-3 text-xs">
                <div className="grid grid-cols-2 gap-2 bg-neutral-950/40 p-3 rounded-2xl border border-white/5">
                  <div>
                    <span className="text-[9px] text-white/30 uppercase font-black tracking-widest block">País</span>
                    <span className="text-white font-medium">{selectedUser.country || "No especificado"}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-white/30 uppercase font-black tracking-widest block">Género</span>
                    <span className="text-white font-medium">{selectedUser.gender || "No especificado"}</span>
                  </div>
                </div>

                <div className="bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-2">
                  <h4 className="font-bold text-white text-[10px] uppercase tracking-wider text-cyan-neon">Configuración de Arco</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[9px] text-white/30 uppercase font-bold block">Tipo</span>
                      <span className="text-white font-medium">{selectedUser.bowConfig?.type || "Ninguno"}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-white/30 uppercase font-bold block">Marca/Modelo</span>
                      <span className="text-white font-medium truncate">{selectedUser.bowConfig?.brand || ""} {selectedUser.bowConfig?.model || ""}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-white/30 uppercase font-bold block">Libras</span>
                      <span className="text-white font-medium">{selectedUser.bowConfig?.poundage || 0} lbs</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-white/30 uppercase font-bold block">Distancia Default</span>
                      <span className="text-white font-medium">{selectedUser.bowConfig?.defaultDistance || 0}m</span>
                    </div>
                  </div>
                </div>

                <div className="bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-1.5">
                  <h4 className="font-bold text-white text-[10px] uppercase tracking-wider text-cyan-neon">Datos del Club</h4>
                  <div className="grid grid-cols-2 gap-1.5">
                    <span className="text-white/60">Nombre del Club:</span>
                    <span className="text-white font-bold text-right truncate">{selectedUser.clubName || "N/A"}</span>

                    <span className="text-white/60">ID del Club:</span>
                    <span className="text-white font-bold text-right truncate text-[10px]">{selectedUser.clubId || "N/A"}</span>

                    <span className="text-white/60">WhatsApp Soporte:</span>
                    <span className="text-white font-bold text-right truncate">{selectedUser.whatsappNumber || "N/A"}</span>
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
