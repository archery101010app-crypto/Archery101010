"use client";

import React, { useState } from "react";
import { 
  BarChart3, 
  Users, 
  Megaphone, 
  CreditCard, 
  Settings, 
  ArrowLeft,
  Menu,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";

// Tabs Components
import AdminDashboardTab from "./tabs/AdminDashboardTab";
import AdminUsersTab from "./tabs/AdminUsersTab";
import AdminCampaignsTab from "./tabs/AdminCampaignsTab";
import AdminSubscriptionsTab from "./tabs/AdminSubscriptionsTab";
import AdminSettingsTab from "./tabs/AdminSettingsTab";

interface SuperAdminViewProps {
  user: UserProfile;
  onBack: () => void;
}

type TabType = "DASHBOARD" | "USERS" | "CAMPAIGNS" | "SUBSCRIPTIONS" | "SETTINGS";

export default function SuperAdminView({ user, onBack }: SuperAdminViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>("DASHBOARD");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const tabsConfig = [
    { id: "DASHBOARD", label: "Dashboard", icon: BarChart3, component: AdminDashboardTab },
    { id: "USERS", label: "Usuarios", icon: Users, component: AdminUsersTab },
    { id: "CAMPAIGNS", label: "Campañas", icon: Megaphone, component: AdminCampaignsTab },
    { id: "SUBSCRIPTIONS", label: "Suscripciones", icon: CreditCard, component: AdminSubscriptionsTab },
    { id: "SETTINGS", label: "Configuración", icon: Settings, component: AdminSettingsTab }
  ];

  const currentTab = tabsConfig.find((t) => t.id === activeTab);
  const ActiveComponent = currentTab ? currentTab.component : AdminDashboardTab;

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-white flex flex-col md:flex-row relative">
      
      {/* MOBILE HEADER & TABS (< 768px) */}
      <div className="md:hidden flex flex-col w-full bg-[#0E0E12] border-b border-white/10 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button 
              onClick={onBack}
              className="p-1.5 rounded-xl bg-white/5 text-white/70 hover:text-white"
            >
              <ArrowLeft size={16} />
            </button>
            <h1 className="text-xs font-black uppercase tracking-widest text-cyan-neon">Super Admin</h1>
          </div>
          <span className="text-[10px] font-bold text-white/50">{user.email}</span>
        </div>

        {/* Scrollable Horizontal Tab Bar */}
        <div className="flex overflow-x-auto scrollbar-none px-2 pb-1 gap-1">
          {tabsConfig.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex-shrink-0 transition-all cursor-pointer ${
                  isActive
                    ? "bg-cyan-brand/20 text-cyan-neon border border-cyan-neon/20"
                    : "text-white/40 border border-transparent hover:text-white/70"
                }`}
              >
                <TabIcon size={12} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TABLET / DESKTOP SIDEBAR (>= 768px) */}
      <div 
        className={`hidden md:flex flex-col border-r border-white/10 bg-[#0E0E12] sticky top-0 h-screen transition-all duration-300 flex-shrink-0 z-40 ${
          sidebarCollapsed ? "w-16" : "w-60"
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 flex items-center justify-between border-b border-white/5">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-widest text-cyan-neon">Super Admin Panel</span>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white mx-auto cursor-pointer"
          >
            {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 px-3 py-4 flex flex-col gap-1.5">
          {tabsConfig.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center rounded-xl p-3 text-xs font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                  isActive
                    ? "bg-cyan-brand/20 text-cyan-neon border border-cyan-neon/20"
                    : "text-white/40 border border-transparent hover:bg-white/5 hover:text-white/80"
                } ${sidebarCollapsed ? "justify-center" : "gap-3"}`}
                title={sidebarCollapsed ? tab.label : undefined}
              >
                <TabIcon size={16} className="flex-shrink-0" />
                {!sidebarCollapsed && <span>{tab.label}</span>}
              </button>
            );
          })}
        </div>

        {/* Back control & Account Details at bottom */}
        <div className="p-4 border-t border-white/5 flex flex-col gap-2">
          {!sidebarCollapsed && (
            <div className="flex flex-col mb-1.5">
              <span className="text-[9px] font-black text-white/30 uppercase tracking-widest leading-none">Usuario</span>
              <span className="text-[10px] text-white/60 truncate font-semibold mt-0.5">{user.email}</span>
            </div>
          )}
          
          <button
            onClick={onBack}
            className={`flex items-center rounded-xl p-2.5 bg-neutral-900 border border-white/5 text-xs font-bold text-white/80 hover:text-white hover:border-white/15 transition cursor-pointer ${
              sidebarCollapsed ? "justify-center" : "gap-2"
            }`}
          >
            <ArrowLeft size={14} />
            {!sidebarCollapsed && <span>Volver a la App</span>}
          </button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 w-full overflow-y-auto max-h-[calc(100vh-100px)] md:max-h-screen">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full"
          >
            <ActiveComponent />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
