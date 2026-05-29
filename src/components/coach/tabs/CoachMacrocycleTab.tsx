"use client";

import React, { useState } from "react";
import { UserProfile } from "@/lib/authService";
import { Lock, Sparkles, Plus, Calendar, CheckCircle2 } from "lucide-react";
import { saveLocalSetting } from "@/lib/db/indexedDB";

interface CoachMacrocycleTabProps {
  user: UserProfile;
  onUpgrade: () => void;
}

export default function CoachMacrocycleTab({ user, onUpgrade }: CoachMacrocycleTabProps) {
  const isPro = user.plan === "PRO";

  const [macrociclos, setMacrociclos] = useState<any[]>([
    {
      id: "MAC-1",
      name: "Preparación Temporada Indoor",
      startDate: "2026-06-01",
      endDate: "2026-09-30",
      active: true,
      phase: "Volumen",
      volumeGoal: 8000,
      volumeCurrent: 3480
    }
  ]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("Volumen");
  const [goal, setGoal] = useState(5000);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newMacro = {
      id: `MAC-${Date.now()}`,
      name: name,
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      active: false,
      phase: phase,
      volumeGoal: goal,
      volumeCurrent: 0
    };

    setMacrociclos([...macrociclos, newMacro]);
    setShowCreateModal(false);
    setName("");
  };

  if (!isPro) {
    return (
      <div className="relative min-h-[300px] bg-neutral-950/40 rounded-3xl border border-white/5 p-6 flex flex-col items-center justify-center text-center overflow-hidden">
        {/* Backdrop overlay */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-10" />

        <div className="flex flex-col items-center gap-3.5 z-20 max-w-xs">
          <div className="w-12 h-12 rounded-2xl bg-yellow-gold/10 border border-yellow-gold/30 flex items-center justify-center text-yellow-gold shadow-glow-yellow animate-pulse">
            <Lock size={20} />
          </div>

          <span className="text-[10px] bg-yellow-gold text-black font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
            Exclusivo Coach PRO
          </span>

          <h3 className="text-white text-base font-black uppercase tracking-wide">
            Planificación de Macrociclos
          </h3>

          <p className="text-[11px] text-gray-dim leading-relaxed">
            Planifica la temporada olímpica de tu club. Diseña macrociclos con fases de preparación física, volumen, puesta a punto y competitiva. Define metas de flechas y supervisa el progreso de todo el equipo en tiempo real.
          </p>

          <button
            onClick={onUpgrade}
            className="w-full mt-3 py-3 rounded-full bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black text-xs uppercase tracking-wider shadow-glow-yellow hover:brightness-105 active:scale-98 transition cursor-pointer"
          >
            Adquirir Plan PRO
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 relative">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-gray-dim font-black uppercase tracking-wider">Macrociclos Activos</span>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 rounded-xl bg-cyan-neon text-black font-black text-[9px] uppercase tracking-wider flex items-center gap-1 cursor-pointer hover:bg-cyan-brand transition"
        >
          <Plus size={12} />
          <span>Crear Plan</span>
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {macrociclos.map((mac) => {
          const progress = Math.min(100, Math.round((mac.volumeCurrent / mac.volumeGoal) * 100));
          return (
            <div
              key={mac.id}
              className="bg-neutral-900/40 p-4 rounded-3xl border border-white/10 flex flex-col gap-3"
            >
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-0.5">
                  <h4 className="text-white text-sm font-bold">{mac.name}</h4>
                  <span className="text-[9px] text-gray-dim">
                    {mac.startDate} al {mac.endDate}
                  </span>
                </div>
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-cyan-neon/15 border border-cyan-neon/20 text-cyan-neon">
                  Fase: {mac.phase}
                </span>
              </div>

              {/* Progress bar */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[9px]">
                  <span className="text-gray-dim">Volumen Acumulado del Club:</span>
                  <span className="text-white font-extrabold">{mac.volumeCurrent.toLocaleString()} / {mac.volumeGoal.toLocaleString()} flechas</span>
                </div>
                <div className="w-full bg-neutral-950 h-2 rounded-full overflow-hidden border border-white/5">
                  <div className="bg-cyan-neon h-full rounded-full" style={{ width: `${progress}%` }} />
                </div>
              </div>

              {/* Chronogram */}
              <div className="flex flex-col gap-1.5 mt-1 border-t border-white/[0.03] pt-3">
                <span className="text-[8px] text-gray-dim font-bold uppercase tracking-wider">Cronograma de Fases</span>
                <div className="grid grid-cols-4 gap-1.5 mt-0.5">
                  {[
                    { name: "Física", active: mac.phase === "Física" },
                    { name: "Volumen", active: mac.phase === "Volumen" },
                    { name: "Puesta Punto", active: mac.phase === "Puesta Punto" },
                    { name: "Competitiva", active: mac.phase === "Competitiva" }
                  ].map((phase, idx) => (
                    <div key={idx} className="flex flex-col items-center gap-1">
                      <div className={`w-full h-1.5 rounded-full ${
                        phase.active 
                          ? "bg-cyan-neon shadow-glow-cyan animate-pulse" 
                          : "bg-neutral-800"
                      }`} />
                      <span className={`text-[7px] font-black uppercase text-center leading-none ${
                        phase.active ? "text-cyan-neon" : "text-gray-dim"
                      }`}>
                        {phase.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal for creating a new macrocycle */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/10 p-5 rounded-3xl w-full max-w-sm flex flex-col gap-4">
            <h3 className="text-white text-sm font-black uppercase tracking-wider">Nuevo Macrociclo</h3>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-gray-dim uppercase font-bold">Nombre del Plan</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ej: Preparación Panamericano 2026"
                  className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-gray-dim uppercase font-bold">Fase Inicial</label>
                <select
                  value={phase}
                  onChange={(e) => setPhase(e.target.value)}
                  className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                >
                  <option value="Física">Preparación Física</option>
                  <option value="Volumen">Volumen de Flechas</option>
                  <option value="Puesta Punto">Puesta a Punto</option>
                  <option value="Competitiva">Competencia</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-gray-dim uppercase font-bold">Meta de Volumen (Flechas)</label>
                <input
                  type="number"
                  required
                  value={goal}
                  onChange={(e) => setGoal(Number(e.target.value))}
                  className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                />
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-transparent border border-white/5 text-gray-dim hover:text-white font-bold text-xs uppercase"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-cyan-neon text-black font-black text-xs uppercase shadow-glow-cyan"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
