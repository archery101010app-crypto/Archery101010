"use client";

import React from "react";
import { Users, UserCheck, CreditCard, DollarSign, Activity, Calendar, Award } from "lucide-react";
import { motion } from "framer-motion";

export default function AdminDashboardTab() {
  const kpis = [
    {
      title: "Total Usuarios",
      value: "245",
      change: "+12% este mes",
      icon: Users,
      colorClass: "text-cyan-neon bg-cyan-neon/10 border-cyan-neon/20 shadow-[0_0_15px_rgba(0,191,255,0.1)]",
      textColor: "text-cyan-neon"
    },
    {
      title: "Activos Hoy",
      value: "38",
      change: "+5% vs ayer",
      icon: UserCheck,
      colorClass: "text-green-500 bg-green-500/10 border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]",
      textColor: "text-green-400"
    },
    {
      title: "Suscriptores PRO",
      value: "12",
      change: "+2 nuevos esta semana",
      icon: CreditCard,
      colorClass: "text-yellow-gold bg-yellow-gold/10 border-yellow-gold/20 shadow-[0_0_15px_rgba(255,229,0,0.1)]",
      textColor: "text-yellow-400"
    },
    {
      title: "Ingresos Est. (Mes)",
      value: "$59.88",
      change: "+$9.99 hoy",
      icon: DollarSign,
      colorClass: "text-purple-500 bg-purple-500/10 border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.1)]",
      textColor: "text-purple-400"
    }
  ];

  const recentActivity = [
    {
      id: "act-1",
      user: "Carlos Mendoza",
      action: "inició una nueva sesión de entrenamiento",
      detail: "72 flechas a 50m (Recurvo)",
      time: "hace 5 minutos",
      icon: Activity,
      iconColor: "text-cyan-neon"
    },
    {
      id: "act-2",
      user: "Daniela Rivas",
      action: "creó un macrociclo de preparación",
      detail: "Preparación Sala 2026",
      time: "hace 42 minutos",
      icon: Calendar,
      iconColor: "text-purple-500"
    },
    {
      id: "act-3",
      user: "Sebastián Gómez",
      action: "se registró en el club",
      detail: "Club Olímpico San José",
      time: "hace 2 horas",
      icon: Users,
      iconColor: "text-green-500"
    },
    {
      id: "act-4",
      user: "Alejandro Ruiz",
      action: "desafió a un arquero a duelo",
      detail: "Ronda de 18 flechas a 18m",
      time: "hace 5 horas",
      icon: Award,
      iconColor: "text-yellow-gold"
    },
    {
      id: "act-5",
      user: "María Fernanda",
      action: "se suscribió a cuenta PRO",
      detail: "Plan Mensual Coach PRO",
      time: "hace 1 día",
      icon: CreditCard,
      iconColor: "text-purple-500"
    }
  ];

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 260, damping: 25 } }
  };

  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-6 w-full p-4 md:p-6"
    >
      <div>
        <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wider">Dashboard de Administración</h2>
        <p className="text-xs text-white/50">Métricas clave y actividad reciente de Archery 101010.</p>
      </div>

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={idx}
              variants={item}
              className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden group hover:border-white/20 transition-all duration-300 shadow-xl"
            >
              {/* Glow indicator */}
              <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
              
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] md:text-xs font-bold text-white/60 uppercase tracking-widest">{kpi.title}</span>
                <div className={`p-2 rounded-xl border flex items-center justify-center ${kpi.colorClass}`}>
                  <Icon size={18} />
                </div>
              </div>

              <div>
                <h3 className={`text-2xl md:text-3xl font-black tracking-tight ${kpi.textColor}`}>
                  {kpi.value}
                </h3>
                <span className="text-[9px] md:text-xs text-white/40 font-medium block mt-1">{kpi.change}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Main Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full mt-2">
        {/* Activity Timeline */}
        <motion.div
          variants={item}
          className="lg:col-span-2 bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4"
        >
          <div className="flex justify-between items-center border-b border-white/5 pb-3">
            <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Activity size={16} className="text-cyan-neon" />
              <span>Actividad en Tiempo Real</span>
            </h3>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-neon opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-neon"></span>
            </span>
          </div>

          <div className="flex flex-col gap-4 mt-2">
            {recentActivity.map((act, index) => {
              const ActIcon = act.icon;
              return (
                <div key={act.id} className="flex gap-4 relative">
                  {/* Timeline line */}
                  {index !== recentActivity.length - 1 && (
                    <div className="absolute left-[18px] top-9 bottom-[-16px] w-[1px] bg-white/5" />
                  )}

                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center flex-shrink-0 ${act.iconColor}`}>
                    <ActIcon size={16} />
                  </div>

                  {/* Text details */}
                  <div className="flex-1 flex flex-col justify-center min-w-0">
                    <p className="text-xs text-white/80 leading-relaxed font-medium">
                      <span className="font-bold text-white">{act.user}</span> {act.action}
                    </p>
                    <span className="text-[10px] text-cyan-neon/80 font-bold mt-0.5">{act.detail}</span>
                  </div>

                  {/* Time badge */}
                  <div className="text-[9px] text-white/30 font-semibold self-start whitespace-nowrap pt-1">
                    {act.time}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* System Stats / Tech */}
        <motion.div
          variants={item}
          className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4"
        >
          <h3 className="text-sm font-black text-white uppercase tracking-wider border-b border-white/5 pb-3">
            Estado de Sincronización
          </h3>

          <div className="flex flex-col gap-4 mt-2">
            <div className="bg-neutral-950/60 rounded-2xl p-4 border border-white/5">
              <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">Base de Datos</span>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-white/80 font-bold">Estado Firebase</span>
                <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full font-black border border-green-500/20">ONLINE</span>
              </div>
              <div className="flex justify-between items-center mt-2.5">
                <span className="text-xs text-white/80 font-bold">Modo Offline-First</span>
                <span className="text-[10px] text-cyan-neon bg-cyan-brand/20 px-2 py-0.5 rounded-full font-black border border-cyan-neon/20">ACTIVO</span>
              </div>
            </div>

            <div className="bg-neutral-950/60 rounded-2xl p-4 border border-white/5 flex flex-col gap-1">
              <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">Estadísticas de Tráfico</span>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-white/80 font-medium">Sesiones Guardadas Local</span>
                <span className="text-xs text-white font-bold">428</span>
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <span className="text-xs text-white/80 font-medium">Cola de Sincronización</span>
                <span className="text-xs text-white font-bold">0 Items</span>
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <span className="text-xs text-white/80 font-medium">Latencia Promedio</span>
                <span className="text-xs text-green-400 font-bold">~14ms</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
