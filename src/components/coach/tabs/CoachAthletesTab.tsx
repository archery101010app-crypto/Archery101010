"use client";

import React, { useState } from "react";
import { UserProfile } from "@/lib/authService";
import { Search, SlidersHorizontal, ChevronRight, Award } from "lucide-react";

interface CoachAthletesTabProps {
  athletes: UserProfile[];
  onViewAthlete: (athlete: UserProfile) => void;
  sessions: any[];
}

export default function CoachAthletesTab({ athletes, onViewAthlete, sessions }: CoachAthletesTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [bowFilter, setBowFilter] = useState<string>("ALL");

  // Calculate active states
  const getAthleteStats = (uid: string) => {
    const athSess = sessions.filter(s => s.userId === uid || s.userUid === uid);
    const count = athSess.length;
    const lastTime = count > 0 ? Math.max(...athSess.map(s => s.timestamp)) : 0;
    const averageScore = athSess.filter(s => !s.isDuel).length > 0
      ? Math.round(athSess.filter(s => !s.isDuel).reduce((sum, s) => sum + s.score, 0) / athSess.filter(s => !s.isDuel).length)
      : 0;

    return { count, lastTime, averageScore };
  };

  const filteredAthletes = athletes.filter(ath => {
    const matchesSearch = (ath.fullName || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (ath.email || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBow = bowFilter === "ALL" || ath.bowConfig?.type === bowFilter;
    return matchesSearch && matchesBow;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Search and Filters */}
      <div className="flex gap-2">
        <div className="flex-1 bg-neutral-900/60 border border-white/5 rounded-xl px-3 py-2 flex items-center gap-2">
          <Search size={14} className="text-gray-dim" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar arquero..."
            className="bg-transparent border-none text-white text-xs outline-none flex-1 placeholder:text-gray-dim"
          />
        </div>

        <select
          value={bowFilter}
          onChange={(e) => setBowFilter(e.target.value)}
          className="bg-neutral-900/60 border border-white/5 rounded-xl text-gray-dim text-xs px-3 outline-none cursor-pointer"
        >
          <option value="ALL">Todos los Arcos</option>
          <option value="Recurve">Recurvo</option>
          <option value="Compound">Compuesto</option>
          <option value="Barebow">Barebow</option>
        </select>
      </div>

      {/* Roster list */}
      <div className="flex flex-col gap-2.5">
        {filteredAthletes.length === 0 ? (
          <p className="text-[11px] text-gray-dim text-center py-8">No se encontraron atletas.</p>
        ) : (
          filteredAthletes.map((ath) => {
            const stats = getAthleteStats(ath.uid);
            const isOnlineSim = stats.lastTime > (Date.now() - 3 * 24 * 60 * 60 * 1000); // active in last 3 days
            
            return (
              <div
                key={ath.uid}
                onClick={() => onViewAthlete(ath)}
                className="bg-neutral-900/40 p-3.5 rounded-2xl border border-white/5 hover:border-cyan-neon/20 hover:bg-neutral-900/60 transition cursor-pointer flex justify-between items-center group"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center font-black text-xs text-white">
                      {ath.fullName.substring(0, 2).toUpperCase()}
                    </div>
                    {isOnlineSim && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-cyan-neon border-2 border-neutral-950 animate-pulse shadow-glow-cyan" />
                    )}
                  </div>

                  <div className="flex flex-col">
                    <span className="text-white text-xs font-bold leading-tight group-hover:text-cyan-neon transition-colors">
                      {ath.fullName}
                    </span>
                    <span className="text-[9px] text-gray-dim mt-0.5">
                      {ath.bowConfig?.type || "Barebow"} · {ath.bowConfig?.poundage ? `${ath.bowConfig.poundage}#` : "—"} · {stats.count} prácticas
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  {stats.averageScore > 0 && (
                    <div className="flex flex-col text-right">
                      <span className="text-xs font-black text-yellow-gold">{stats.averageScore}</span>
                      <span className="text-[8px] text-gray-dim leading-none">Promedio</span>
                    </div>
                  )}
                  <ChevronRight size={14} className="text-gray-dim group-hover:text-white transition-colors" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
