"use client";

import React, { useState } from "react";
import { UserProfile } from "@/lib/authService";
import { Award, Share2, Filter, BarChart3 } from "lucide-react";

interface CoachSessionsTabProps {
  athletes: UserProfile[];
  sessions: any[];
}

export default function CoachSessionsTab({ athletes, sessions }: CoachSessionsTabProps) {
  const [filterType, setFilterType] = useState<string>("ALL");

  const athleteSessions = sessions.filter(s => !s.isDuel);

  const filteredSessions = athleteSessions.filter(s => {
    if (filterType === "ALL") return true;
    return s.practiceType === filterType;
  });

  // Calculate weekly ranking (Top 3 scores)
  const getWeeklyRanking = () => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklySess = athleteSessions.filter(s => s.timestamp >= oneWeekAgo);
    
    // Group by athlete, get their maximum score
    const maxScores: Record<string, { userName: string; score: number; format: string }> = {};
    weeklySess.forEach(s => {
      if (!maxScores[s.userId] || s.score > maxScores[s.userId].score) {
        maxScores[s.userId] = {
          userName: s.userName,
          score: s.score,
          format: s.format
        };
      }
    });

    return Object.values(maxScores)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  };

  const ranking = getWeeklyRanking();

  const handleShareWhatsApp = () => {
    const rankingText = ranking.length > 0 
      ? ranking.map((r, idx) => `${idx + 1}. 🏹 ${r.userName} - ${r.score} pts (${r.format})`).join("\n")
      : "No hay registros esta semana.";

    const fullMessage = `*REPORTE DE CONTROLES - CLUB ARCHERY*\n\n🏆 *Top Podio de la Semana:*\n${rankingText}\n\n¡Felicidades a todos por los entrenamientos! 💪🎯`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Podio Semanal */}
      {ranking.length > 0 && (
        <div className="bg-gradient-to-br from-yellow-gold/15 via-neutral-900/40 to-neutral-900/60 p-4 rounded-3xl border border-yellow-gold/20 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Award size={14} className="text-yellow-gold animate-bounce" />
              Podio de Controles Semanal
            </h4>
            <button
              onClick={handleShareWhatsApp}
              className="p-2 rounded-xl bg-neutral-950 border border-white/5 text-gray-dim hover:text-white cursor-pointer transition flex items-center gap-1 text-[9px] font-black uppercase tracking-wider"
            >
              <Share2 size={10} />
              <span>Compartir</span>
            </button>
          </div>

          <div className="flex flex-col gap-2 mt-1">
            {ranking.map((rank, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950/60 border border-white/[0.03]"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs ${
                    idx === 0 
                      ? "bg-yellow-gold text-black shadow-glow-yellow" 
                      : idx === 1 
                      ? "bg-neutral-300 text-black" 
                      : "bg-amber-600 text-white"
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-white text-xs font-bold">{rank.userName}</span>
                    <span className="text-[8px] text-gray-dim uppercase">{rank.format}</span>
                  </div>
                </div>

                <span className="text-xs font-black text-cyan-neon">{rank.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex justify-between items-center mt-1">
        <span className="text-[10px] text-gray-dim font-black uppercase tracking-wider">Historial de Controles</span>
        <div className="flex gap-1.5">
          {["ALL", "Control", "Práctica", "Volumen"].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition-all ${
                filterType === type
                  ? "bg-cyan-neon text-black"
                  : "bg-neutral-900 border border-white/5 text-gray-dim hover:text-white"
              }`}
            >
              {type === "ALL" ? "Todos" : type}
            </button>
          ))}
        </div>
      </div>

      {/* List of sessions */}
      <div className="flex flex-col gap-2.5">
        {filteredSessions.length === 0 ? (
          <p className="text-[11px] text-gray-dim text-center py-6">No hay registros de controles.</p>
        ) : (
          filteredSessions.map((sess) => {
            const dateStr = new Date(sess.timestamp).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short"
            });
            return (
              <div
                key={sess.id}
                className="bg-neutral-900/40 p-3.5 rounded-2xl border border-white/5 flex justify-between items-center"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-white text-xs font-bold leading-tight">
                    {sess.userName}
                  </span>
                  <span className="text-[9px] text-gray-dim">
                    {sess.practiceType} · {sess.format} · {sess.distance}m · {dateStr}
                  </span>
                </div>
                
                <div className="flex flex-col text-right">
                  <span className="text-sm font-black text-cyan-neon">{sess.score}</span>
                  <span className="text-[8px] text-gray-dim">/ {sess.maxScore || 300} pts</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
