"use client";

import React, { useState, useEffect } from "react";
import { Settings, Save, ShieldAlert, Key, MessageSquare, ToggleLeft, ToggleRight, Sparkles, CheckCircle2, Database, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  settingsStore,
  getLocalSessions,
  getLocalEvents,
  getLocalMacrocycles,
  adCampaignsStore,
  athleteStarsStore,
  starHistoryStore
} from "@/lib/db/indexedDB";

export default function AdminSettingsTab() {
  const [paypalClientId, setPaypalClientId] = useState("");
  const [paypalSecret, setPaypalSecret] = useState("");
  const [supportWhatsapp, setSupportWhatsapp] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  
  // Feature flags
  const [duelsEnabled, setDuelsEnabled] = useState(true);
  const [spotifyEnabled, setSpotifyEnabled] = useState(true);
  const [macrocyclesEnabled, setMacrocyclesEnabled] = useState(true);

  const [isSaved, setIsSaved] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);

  const handleDownloadMasterBackup = async () => {
    setIsBackingUp(true);
    try {
      const backupPayload: Record<string, any> = {
        app: "Archery 101010: The App",
        exportedAt: new Date().toISOString(),
        timestamp: Date.now(),
        collections: {}
      };

      // 1. Collect local IndexedDB stores as baseline
      const users = (await settingsStore.getItem<any[]>("simulated_users")) || [];
      const sessions = await getLocalSessions();
      const calendarEvents = await getLocalEvents();
      const macrocycles = await getLocalMacrocycles();

      const adCampaigns: any[] = [];
      await adCampaignsStore.iterate((val) => {
        adCampaigns.push(val);
      });

      const athleteStars: any[] = [];
      await athleteStarsStore.iterate((val, key) => {
        athleteStars.push({ id: key, ...(typeof val === "object" && val ? val : {}) });
      });

      const starHistory: any[] = [];
      await starHistoryStore.iterate((val, key) => {
        starHistory.push({ id: key, ...(typeof val === "object" && val ? val : {}) });
      });

      backupPayload.collections = {
        users,
        sessions,
        calendar_events: calendarEvents,
        macrocycles,
        ad_campaigns: adCampaigns,
        athlete_stars: athleteStars,
        star_history: starHistory
      };

      // 2. If online, enrich with live Firestore collections
      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          const { collection, getDocs } = await import("firebase/firestore");
          const { db } = await import("@/lib/firebase");
          const colNames = [
            "users",
            "sessions",
            "calendar_events",
            "macrocycles",
            "ad_campaigns",
            "athlete_stars",
            "star_history"
          ];
          await Promise.all(
            colNames.map(async (colName) => {
              try {
                const snap = await getDocs(collection(db, colName));
                if (!snap.empty) {
                  backupPayload.collections[colName] = snap.docs.map((d) => ({
                    id: d.id,
                    ...d.data()
                  }));
                }
              } catch {
                // Keep local fallback if a collection fails
              }
            })
          );
        } catch {
          // Offline or Firestore unavailable; local snapshot used
        }
      }

      const jsonStr = JSON.stringify(backupPayload, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      link.setAttribute("href", url);
      link.setAttribute("download", `archery101010_respaldo_maestro_${today}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate master backup:", err);
      alert("Error al generar el respaldo maestro.");
    } finally {
      setIsBackingUp(false);
    }
  };

  useEffect(() => {
    async function loadSettings() {
      const pId = await settingsStore.getItem<string>("paypal_client_id") || "";
      const pSec = await settingsStore.getItem<string>("paypal_secret") || "";
      const wapp = await settingsStore.getItem<string>("support_whatsapp") || "";
      const email = await settingsStore.getItem<string>("support_email") || "info@archery101010.com";
      const flagDuels = await settingsStore.getItem<boolean>("flag_duels_enabled");
      const flagSpotify = await settingsStore.getItem<boolean>("flag_spotify_enabled");
      const flagMacro = await settingsStore.getItem<boolean>("flag_macrocycles_enabled");

      setPaypalClientId(pId);
      setPaypalSecret(pSec);
      setSupportWhatsapp(wapp);
      setSupportEmail(email);
      setDuelsEnabled(flagDuels !== null ? flagDuels : true);
      setSpotifyEnabled(flagSpotify !== null ? flagSpotify : true);
      setMacrocyclesEnabled(flagMacro !== null ? flagMacro : true);
    }
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    await settingsStore.setItem("paypal_client_id", paypalClientId);
    await settingsStore.setItem("paypal_secret", paypalSecret);
    await settingsStore.setItem("support_whatsapp", supportWhatsapp);
    await settingsStore.setItem("support_email", supportEmail);
    await settingsStore.setItem("flag_duels_enabled", duelsEnabled);
    await settingsStore.setItem("flag_spotify_enabled", spotifyEnabled);
    await settingsStore.setItem("flag_macrocycles_enabled", macrocyclesEnabled);

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="flex flex-col gap-5 w-full p-4 md:p-6 max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-[22px] md:text-[26.4px] font-black text-white uppercase tracking-wider">Configuración General</h2>
        <p className="text-xs text-white">Ajusta credenciales del sistema, canales de soporte y habilita funcionalidades.</p>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-5 mt-2">
        {/* Section: PayPal Keys */}
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2 flex items-center gap-1.5">
            <Key size={14} className="text-yellow-gold" />
            <span>Pasarela de Pago (PayPal API)</span>
          </h3>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10.5px] text-white uppercase font-black tracking-widest">PayPal Client ID</label>
              <input
                type="password"
                value={paypalClientId}
                onChange={(e) => setPaypalClientId(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon tracking-widest"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10.5px] text-white uppercase font-black tracking-widest">PayPal Secret Key</label>
              <input
                type="password"
                value={paypalSecret}
                onChange={(e) => setPaypalSecret(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon tracking-widest"
              />
            </div>
          </div>
        </div>

        {/* Section: Support Channels */}
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2 flex items-center gap-1.5">
            <MessageSquare size={14} className="text-cyan-neon" />
            <span>Contacto & Soporte</span>
          </h3>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10.5px] text-white uppercase font-black tracking-widest">WhatsApp de Soporte</label>
              <input
                type="tel"
                value={supportWhatsapp}
                onChange={(e) => setSupportWhatsapp(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon"
                placeholder="+50688888888"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10.5px] text-white uppercase font-black tracking-widest">Email de Contacto</label>
              <input
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon"
                placeholder="contacto@archery101010.com"
              />
            </div>
          </div>
        </div>

        {/* Section: Feature Flags */}
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2 flex items-center gap-1.5">
            <Settings size={14} className="text-cyan-neon" />
            <span>Módulos y Funcionalidades</span>
          </h3>

          <div className="flex flex-col gap-3.5 mt-1">
            {/* Duel Module Flag */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Módulo de Duelos</span>
                <span className="text-[10.5px] text-white block">Habilita duelos directos cara a cara entre arqueros.</span>
              </div>
              <button
                type="button"
                onClick={() => setDuelsEnabled(!duelsEnabled)}
                className="text-cyan-neon hover:text-white transition cursor-pointer"
              >
                {duelsEnabled ? (
                  <ToggleRight size={26} className="text-cyan-neon" />
                ) : (
                  <ToggleLeft size={26} className="text-white" />
                )}
              </button>
            </div>

            {/* Spotify Flag */}
            <div className="flex items-center justify-between border-t border-white/5 pt-3">
              <div>
                <span className="text-xs font-bold text-white block">Música de Competencia (Spotify)</span>
                <span className="text-[10.5px] text-white block">Mostrar widget de música ambiental en reloj de tiro.</span>
              </div>
              <button
                type="button"
                onClick={() => setSpotifyEnabled(!spotifyEnabled)}
                className="text-cyan-neon hover:text-white transition cursor-pointer"
              >
                {spotifyEnabled ? (
                  <ToggleRight size={26} className="text-cyan-neon" />
                ) : (
                  <ToggleLeft size={26} className="text-white" />
                )}
              </button>
            </div>

            {/* Macrocycle Flag */}
            <div className="flex items-center justify-between border-t border-white/5 pt-3">
              <div>
                <span className="text-xs font-bold text-white block">Módulo de Ciclos</span>
                <span className="text-[10.5px] text-white block">Habilita planificación avanzada de ciclos de entrenamiento.</span>
              </div>
              <button
                type="button"
                onClick={() => setMacrocyclesEnabled(!macrocyclesEnabled)}
                className="text-cyan-neon hover:text-white transition cursor-pointer"
              >
                {macrocyclesEnabled ? (
                  <ToggleRight size={26} className="text-cyan-neon" />
                ) : (
                  <ToggleLeft size={26} className="text-white" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Section: Master Cloud & Local Backup */}
        <div className="bg-neutral-900/40 border border-cyan-neon/25 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-3">
          <h3 className="text-xs font-black text-cyan-neon uppercase tracking-widest border-b border-white/5 pb-2 flex items-center gap-1.5">
            <Database size={14} className="text-cyan-neon" />
            <span>Respaldo Maestro de Base de Datos (Snapshot .JSON)</span>
          </h3>
          <p className="text-xs text-white leading-relaxed">
            Descarga una copia de seguridad completa e instantánea con todos los usuarios, perfiles demográficos, sesiones de tiro, calendarios, macrociclos, estrellas y campañas publicitarias de Firestore + IndexedDB.
          </p>
          <button
            type="button"
            onClick={handleDownloadMasterBackup}
            disabled={isBackingUp}
            className="self-start mt-1 py-2.5 px-4 bg-white/10 hover:bg-cyan-neon hover:text-black border border-cyan-neon/30 text-cyan-neon font-black text-xs uppercase tracking-wider rounded-xl flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
          >
            <Download size={14} />
            <span>{isBackingUp ? "Generando Respaldo..." : "Descargar Respaldo Maestro (.JSON)"}</span>
          </button>
        </div>

        {/* Form Footer Action */}
        <div className="flex items-center gap-3 mt-1.5 self-end w-full sm:w-auto">
          <AnimatePresence>
            {isSaved && (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="text-green-400 font-bold text-xs flex items-center gap-1.5 mr-2"
              >
                <CheckCircle2 size={14} />
                <span>Configuraciones guardadas localmente</span>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            className="w-full sm:w-auto py-3 px-6 bg-cyan-neon text-black font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-1.5 shadow-glow-cyan cursor-pointer transition hover:scale-102"
          >
            <Save size={14} />
            <span>Guardar Ajustes</span>
          </button>
        </div>
      </form>
    </div>
  );
}
