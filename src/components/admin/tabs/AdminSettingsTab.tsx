"use client";

import React, { useState, useEffect, useId } from "react";
import {
  Settings,
  Save,
  Key,
  MessageSquare,
  ToggleLeft,
  ToggleRight,
  CheckCircle2,
  Database,
  Download
} from "lucide-react";
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
import { downloadOrShareFile } from "@/lib/fileDownload";
import { showOledAlert } from "@/lib/oledDialog";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { getLocalISODate } from "@/lib/i18n/regionalUtils";

export default function AdminSettingsTab() {
  const { t, tx } = useLanguage();
  const baseId = useId();
  const [paypalClientId, setPaypalClientId] = useState("");
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
        app: "ARCHERY 101010: THE APP",
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

      // 2. If online, enrich with bounded live Firestore collections (limit 200 per collection)
      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          const { collection, getDocs, query, limit } = await import("firebase/firestore");
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
                const snap = await getDocs(query(collection(db, colName), limit(200)));
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
      const today = getLocalISODate();
      await downloadOrShareFile({
        filename: `archery101010_master_backup_${today}.json`,
        mimeType: "application/json;charset=utf-8",
        data: jsonStr,
        shareTitle: tx("Respaldo Maestro ARCHERY 101010", "ARCHERY 101010 Master Backup")
      });
    } catch (err) {
      console.error("Failed to generate master backup:", err);
      await showOledAlert(
        tx("Error al generar el respaldo maestro.", "Failed to generate master backup.")
      );
    } finally {
      setIsBackingUp(false);
    }
  };

  useEffect(() => {
    async function loadSettings() {
      // Purge any legacy client-side secret key that may exist from older builds
      await settingsStore.removeItem("paypal_secret").catch(() => {});

      const pId = (await settingsStore.getItem<string>("paypal_client_id")) || "";
      const wapp = (await settingsStore.getItem<string>("support_whatsapp")) || "";
      const email =
        (await settingsStore.getItem<string>("support_email")) || "info@archery101010.com";
      const flagDuels = await settingsStore.getItem<boolean>("flag_duels_enabled");
      const flagSpotify = await settingsStore.getItem<boolean>("flag_spotify_enabled");
      const flagMacro = await settingsStore.getItem<boolean>("flag_macrocycles_enabled");

      setPaypalClientId(pId);
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

    await settingsStore.removeItem("paypal_secret").catch(() => {});
    await settingsStore.setItem("paypal_client_id", paypalClientId);
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
        <h2
          id={`${baseId}-heading`}
          className="text-[22px] md:text-[26.4px] font-black text-white uppercase tracking-wider"
        >
          {tx("Configuración General", "General Settings")}
        </h2>
        <p className="text-xs text-white">
          {tx(
            "Ajusta identificadores públicos, canales de soporte y habilita funcionalidades.",
            "Configure public gateway identifiers, support channels, and feature modules."
          )}
        </p>
      </div>

      <form
        onSubmit={handleSave}
        aria-labelledby={`${baseId}-heading`}
        className="flex flex-col gap-5 mt-2"
      >
        {/* Section: Payment Gateway Public Key */}
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2 flex items-center gap-1.5">
            <Key size={14} className="text-yellow-gold" />
            <span>
              {tx("Pasarela de Pago (Identificador Público)", "Payment Gateway (Public Identifier)")}
            </span>
          </h3>

          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${baseId}-clientid`}
                className="text-[10.5px] text-white uppercase font-black tracking-widest"
              >
                {tx("Client ID Público de Pasarela", "Public Gateway Client ID")}
              </label>
              <input
                id={`${baseId}-clientid`}
                name="paypalClientId"
                type="text"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={paypalClientId}
                onChange={(e) => setPaypalClientId(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon tracking-wider tabular-nums"
              />
            </div>
            <p className="text-[11px] text-white leading-relaxed">
              {tx(
                "Por seguridad, ninguna llave secreta privada se solicita ni se almacena en el navegador o IndexedDB.",
                "For security, no private secret key is ever requested or stored in the browser or IndexedDB."
              )}
            </p>
          </div>
        </div>

        {/* Section: Support Channels */}
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2 flex items-center gap-1.5">
            <MessageSquare size={14} className="text-cyan-neon" />
            <span>{tx("Contacto & Soporte", "Contact & Support")}</span>
          </h3>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${baseId}-phone`}
                className="text-[10.5px] text-white uppercase font-black tracking-widest"
              >
                {tx("Teléfono / Mensajería de Soporte", "Support Phone / Messaging")}
              </label>
              <input
                id={`${baseId}-phone`}
                name="supportWhatsapp"
                type="tel"
                autoComplete="tel"
                value={supportWhatsapp}
                onChange={(e) => setSupportWhatsapp(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon tabular-nums"
                placeholder="+50688888888"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${baseId}-email`}
                className="text-[10.5px] text-white uppercase font-black tracking-widest"
              >
                {tx("Email de Contacto", "Contact Email")}
              </label>
              <input
                id={`${baseId}-email`}
                name="supportEmail"
                type="email"
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon"
                placeholder="info@archery101010.com"
              />
            </div>
          </div>
        </div>

        {/* Section: Feature Flags */}
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2 flex items-center gap-1.5">
            <Settings size={14} className="text-cyan-neon" />
            <span>{tx("Módulos y Funcionalidades", "Modules & Features")}</span>
          </h3>

          <div className="flex flex-col gap-3.5 mt-1">
            {/* Duel Module Flag */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold text-white block">
                  {tx("Módulo de Duelos", "Duels Module")}
                </span>
                <span className="text-[10.5px] text-white block">
                  {tx(
                    "Habilita duelos directos cara a cara entre arqueros.",
                    "Enable real-time head-to-head duels between archers."
                  )}
                </span>
              </div>
              <button
                type="button"
                aria-pressed={duelsEnabled}
                onClick={() => setDuelsEnabled(!duelsEnabled)}
                className="text-cyan-neon hover:text-white transition cursor-pointer shrink-0"
              >
                {duelsEnabled ? (
                  <ToggleRight size={26} className="text-cyan-neon" />
                ) : (
                  <ToggleLeft size={26} className="text-white" />
                )}
              </button>
            </div>

            {/* Ambient Music Flag */}
            <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-3">
              <div>
                <span className="text-xs font-bold text-white block">
                  {tx("Música de Competencia", "Competition Audio")}
                </span>
                <span className="text-[10.5px] text-white block">
                  {tx(
                    "Mostrar reproductor de audio ambiental en sesiones de tiro.",
                    "Display ambient competition audio player during shooting sessions."
                  )}
                </span>
              </div>
              <button
                type="button"
                aria-pressed={spotifyEnabled}
                onClick={() => setSpotifyEnabled(!spotifyEnabled)}
                className="text-cyan-neon hover:text-white transition cursor-pointer shrink-0"
              >
                {spotifyEnabled ? (
                  <ToggleRight size={26} className="text-cyan-neon" />
                ) : (
                  <ToggleLeft size={26} className="text-white" />
                )}
              </button>
            </div>

            {/* Macrocycle Flag */}
            <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-3">
              <div>
                <span className="text-xs font-bold text-white block">
                  {tx("Módulo de Ciclos", "Training Cycles Module")}
                </span>
                <span className="text-[10.5px] text-white block">
                  {tx(
                    "Habilita planificación avanzada de ciclos de entrenamiento.",
                    "Enable advanced seasonal training cycle planning."
                  )}
                </span>
              </div>
              <button
                type="button"
                aria-pressed={macrocyclesEnabled}
                onClick={() => setMacrocyclesEnabled(!macrocyclesEnabled)}
                className="text-cyan-neon hover:text-white transition cursor-pointer shrink-0"
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
            <span>
              {tx(
                "Respaldo Maestro de Base de Datos (Snapshot .JSON)",
                "Master Database Backup (.JSON Snapshot)"
              )}
            </span>
          </h3>
          <p className="text-xs text-white leading-relaxed">
            {tx(
              "Descarga una copia de seguridad instantánea con usuarios, perfiles demográficos, sesiones de tiro, calendarios, ciclos, estrellas y campañas publicitarias de la nube (límite de 200 registros recientes por colección) + IndexedDB.",
              "Download an instant backup snapshot including users, demographics, shooting sessions, calendars, cycles, stars, and ad campaigns (bounded to 200 recent records per cloud collection) + IndexedDB."
            )}
          </p>
          <button
            type="button"
            onClick={handleDownloadMasterBackup}
            disabled={isBackingUp}
            className="self-start mt-1 py-2.5 px-4 bg-white/10 hover:bg-cyan-neon hover:text-black border border-cyan-neon/30 text-cyan-neon font-black text-xs uppercase tracking-wider rounded-xl flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
          >
            <Download size={14} />
            <span>
              {isBackingUp
                ? tx("Generando Respaldo...", "Generating Backup...")
                : tx("Descargar Respaldo Maestro (.JSON)", "Download Master Backup (.JSON)")}
            </span>
          </button>
        </div>

        {/* Form Footer Action */}
        <div className="flex items-center gap-3 mt-1.5 self-end w-full sm:w-auto">
          <AnimatePresence>
            {isSaved && (
              <motion.div
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="text-green-400 font-bold text-xs flex items-center gap-1.5 me-2"
              >
                <CheckCircle2 size={14} />
                <span>
                  {tx("Configuraciones guardadas localmente", "Settings saved locally")}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            className="w-full sm:w-auto py-3 px-6 bg-cyan-neon text-black font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-1.5 cursor-pointer transition hover:scale-102"
          >
            <Save size={14} />
            <span>{t("save")}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
