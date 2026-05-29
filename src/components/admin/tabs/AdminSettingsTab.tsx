"use client";

import React, { useState, useEffect } from "react";
import { Settings, Save, ShieldAlert, Key, MessageSquare, ToggleLeft, ToggleRight, Sparkles, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { settingsStore } from "@/lib/db/indexedDB";

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

  useEffect(() => {
    async function loadSettings() {
      const pId = await settingsStore.getItem<string>("paypal_client_id") || "PAYPAL_CLIENT_ID_MOCK_123456789";
      const pSec = await settingsStore.getItem<string>("paypal_secret") || "PAYPAL_SECRET_MOCK_987654321";
      const wapp = await settingsStore.getItem<string>("support_whatsapp") || "+50688888888";
      const email = await settingsStore.getItem<string>("support_email") || "soporte@archery101010.com";
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
        <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wider">Configuración General</h2>
        <p className="text-xs text-white/50">Ajusta credenciales del sistema, canales de soporte y habilita funcionalidades.</p>
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
              <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">PayPal Client ID</label>
              <input
                type="password"
                value={paypalClientId}
                onChange={(e) => setPaypalClientId(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon tracking-widest"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">PayPal Secret Key</label>
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
              <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">WhatsApp de Soporte</label>
              <input
                type="tel"
                value={supportWhatsapp}
                onChange={(e) => setSupportWhatsapp(e.target.value)}
                className="bg-neutral-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon"
                placeholder="+50688888888"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">Email de Contacto</label>
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
            <Settings size={14} className="text-purple-500" />
            <span>Módulos y Funcionalidades</span>
          </h3>

          <div className="flex flex-col gap-3.5 mt-1">
            {/* Duel Module Flag */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Módulo de Duelos</span>
                <span className="text-[9px] text-white/40 block">Habilita duelos directos cara a cara entre arqueros.</span>
              </div>
              <button
                type="button"
                onClick={() => setDuelsEnabled(!duelsEnabled)}
                className="text-cyan-neon hover:text-white/80 transition cursor-pointer"
              >
                {duelsEnabled ? (
                  <ToggleRight size={26} className="text-cyan-neon" />
                ) : (
                  <ToggleLeft size={26} className="text-white/20" />
                )}
              </button>
            </div>

            {/* Spotify Flag */}
            <div className="flex items-center justify-between border-t border-white/5 pt-3">
              <div>
                <span className="text-xs font-bold text-white block">Música de Competencia (Spotify)</span>
                <span className="text-[9px] text-white/40 block">Mostrar widget de música ambiental en reloj de tiro.</span>
              </div>
              <button
                type="button"
                onClick={() => setSpotifyEnabled(!spotifyEnabled)}
                className="text-cyan-neon hover:text-white/80 transition cursor-pointer"
              >
                {spotifyEnabled ? (
                  <ToggleRight size={26} className="text-cyan-neon" />
                ) : (
                  <ToggleLeft size={26} className="text-white/20" />
                )}
              </button>
            </div>

            {/* Macrocycle Flag */}
            <div className="flex items-center justify-between border-t border-white/5 pt-3">
              <div>
                <span className="text-xs font-bold text-white block">Módulo de Macrociclos</span>
                <span className="text-[9px] text-white/40 block">Habilita planificación avanzada de macrociclos de entrenamiento.</span>
              </div>
              <button
                type="button"
                onClick={() => setMacrocyclesEnabled(!macrocyclesEnabled)}
                className="text-cyan-neon hover:text-white/80 transition cursor-pointer"
              >
                {macrocyclesEnabled ? (
                  <ToggleRight size={26} className="text-cyan-neon" />
                ) : (
                  <ToggleLeft size={26} className="text-white/20" />
                )}
              </button>
            </div>
          </div>
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
