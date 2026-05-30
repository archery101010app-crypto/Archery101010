"use client";

import React, { useState, useEffect } from "react";
import { Plus, Megaphone, Trash2, Edit2, Play, Pause, Copy, Calendar, Shield, Monitor, Sparkles, Image as ImageIcon, Eye, X, ArrowLeft, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AdCampaign, AdSlide } from "@/lib/db/adTypes";
import { adCampaignsStore, generateResilientId, addToSyncQueue } from "@/lib/db/indexedDB";
import { seedDemoAdCampaigns } from "@/lib/adManager";

export default function AdminCampaignsTab() {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [step, setStep] = useState(1);

  // Edit campaign ID tracker
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [type, setType] = useState<AdCampaign["type"]>("popup");
  const [slides, setSlides] = useState<AdSlide[]>([
    { id: "slide-1", imageUrl: "", title: "", subtitle: "", linkUrl: "", backgroundColor: "" }
  ]);
  const [startDate, setStartDate] = useState("2026-06-01");
  const [endDate, setEndDate] = useState("2026-09-30");
  const [showOnAppOpen, setShowOnAppOpen] = useState(true);
  const [frequencyMinutes, setFrequencyMinutes] = useState(15);
  const [maxImpressionsPerDay, setMaxImpressionsPerDay] = useState(5);
  const [slideIntervalSeconds, setSlideIntervalSeconds] = useState(5);
  const [targetScreens, setTargetScreens] = useState<string[]>(["HOME"]);
  const [targetRoles, setTargetRoles] = useState<("archer" | "coach")[]>(["archer", "coach"]);
  const [targetPlans, setTargetPlans] = useState<("FREE" | "PRO")[]>(["FREE"]);

  useEffect(() => {
    async function loadCampaigns() {
      // Seed first if empty
      await seedDemoAdCampaigns();
      const keys = await adCampaignsStore.keys();
      const list: AdCampaign[] = [];
      for (const key of keys) {
        const val = await adCampaignsStore.getItem<AdCampaign>(key);
        if (val) list.push(val);
      }
      setCampaigns(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    loadCampaigns();

    const handleDbChange = (e: any) => {
      if (e.detail?.store === "ad_campaigns") {
        loadCampaigns();
      }
    };

    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, []);

  const handleOpenCreateModal = () => {
    setEditingCampaignId(null);
    setName("");
    setType("popup");
    setSlides([{ id: "slide-1", imageUrl: "", title: "", subtitle: "", linkUrl: "", backgroundColor: "" }]);
    setStartDate(new Date().toISOString().split("T")[0]);
    setEndDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
    setShowOnAppOpen(true);
    setFrequencyMinutes(15);
    setMaxImpressionsPerDay(5);
    setSlideIntervalSeconds(5);
    setTargetScreens(["HOME", "TARGET", "HISTORY", "CALENDAR", "PROFILE"]);
    setTargetRoles(["archer", "coach"]);
    setTargetPlans(["FREE"]);
    setStep(1);
    setShowCreateModal(true);
  };

  const handleOpenEditModal = (campaign: AdCampaign) => {
    setEditingCampaignId(campaign.id);
    setName(campaign.name);
    setType(campaign.type);
    setSlides(campaign.slides);
    setStartDate(campaign.startDate);
    setEndDate(campaign.endDate);
    setShowOnAppOpen(campaign.showOnAppOpen);
    setFrequencyMinutes(campaign.frequencyMinutes);
    setMaxImpressionsPerDay(campaign.maxImpressionsPerDay);
    setSlideIntervalSeconds(campaign.slideIntervalSeconds);
    setTargetScreens(campaign.targetScreens);
    setTargetRoles(campaign.targetRoles);
    setTargetPlans(campaign.targetPlans || ["FREE"]);
    setStep(1);
    setShowCreateModal(true);
  };

  const handleAddSlide = () => {
    setSlides([
      ...slides,
      {
        id: `slide-${Date.now()}`,
        imageUrl: "",
        title: "",
        subtitle: "",
        linkUrl: "",
        backgroundColor: ""
      }
    ]);
  };

  const handleRemoveSlide = (id: string) => {
    if (slides.length <= 1) return;
    setSlides(slides.filter((s) => s.id !== id));
  };

  const handleUpdateSlideField = (id: string, field: keyof AdSlide, value: string) => {
    setSlides(
      slides.map((slide) => {
        if (slide.id === id) {
          return { ...slide, [field]: value };
        }
        return slide;
      })
    );
  };

  const handleToggleScreen = (screen: string) => {
    if (targetScreens.includes(screen)) {
      setTargetScreens(targetScreens.filter((s) => s !== screen));
    } else {
      setTargetScreens([...targetScreens, screen]);
    }
  };

  const handleToggleRole = (role: "archer" | "coach") => {
    if (targetRoles.includes(role)) {
      setTargetRoles(targetRoles.filter((r) => r !== role));
    } else {
      setTargetRoles([...targetRoles, role]);
    }
  };

  const handleSaveCampaign = async () => {
    if (!name.trim()) return;

    const campaignId = editingCampaignId || generateResilientId("AD");
    const nowStr = new Date().toISOString();

    const campaignData: AdCampaign = {
      id: campaignId,
      name,
      type,
      status: "active",
      slides: slides.map((s) => ({
        ...s,
        imageUrl: s.imageUrl || "https://images.unsplash.com/photo-1511379938547-c1f69419868d?q=80&w=600&auto=format&fit=crop"
      })),
      startDate,
      endDate,
      showOnAppOpen,
      frequencyMinutes,
      maxImpressionsPerDay,
      slideIntervalSeconds,
      targetScreens,
      targetRoles,
      targetPlans,
      totalImpressions: editingCampaignId ? campaigns.find(c => c.id === editingCampaignId)?.totalImpressions || 0 : 0,
      totalClicks: editingCampaignId ? campaigns.find(c => c.id === editingCampaignId)?.totalClicks || 0 : 0,
      createdAt: editingCampaignId ? campaigns.find(c => c.id === editingCampaignId)?.createdAt || nowStr : nowStr,
      updatedAt: nowStr
    };

    // Save locally
    await adCampaignsStore.setItem(campaignId, campaignData);

    // Save to sync queue
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "ad_campaigns",
      operation: editingCampaignId ? "UPDATE" : "INSERT",
      payloadId: campaignId,
      payload: campaignData,
      timestamp: Date.now()
    });

    // Refresh view
    const keys = await adCampaignsStore.keys();
    const list: AdCampaign[] = [];
    for (const key of keys) {
      const val = await adCampaignsStore.getItem<AdCampaign>(key);
      if (val) list.push(val);
    }
    setCampaigns(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

    setShowCreateModal(false);
  };

  const handleDeleteCampaign = async (id: string) => {
    if (!confirm("¿Estás seguro de que deseas eliminar esta campaña?")) return;

    await adCampaignsStore.removeItem(id);

    // Sync queue
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "ad_campaigns",
      operation: "DELETE",
      payloadId: id,
      payload: null,
      timestamp: Date.now()
    });

    setCampaigns(campaigns.filter((c) => c.id !== id));
  };

  const handleToggleStatus = async (campaign: AdCampaign) => {
    const newStatus = campaign.status === "active" ? "paused" : "active";
    const updated: AdCampaign = {
      ...campaign,
      status: newStatus,
      updatedAt: new Date().toISOString()
    };

    await adCampaignsStore.setItem(campaign.id, updated);

    // Queue sync
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "ad_campaigns",
      operation: "UPDATE",
      payloadId: campaign.id,
      payload: updated,
      timestamp: Date.now()
    });

    setCampaigns(
      campaigns.map((c) => (c.id === campaign.id ? updated : c))
    );
  };

  const handleDuplicateCampaign = async (campaign: AdCampaign) => {
    const duplicatedId = generateResilientId("AD");
    const nowStr = new Date().toISOString();
    const duplicated: AdCampaign = {
      ...campaign,
      id: duplicatedId,
      name: `${campaign.name} (Copia)`,
      status: "paused",
      totalImpressions: 0,
      totalClicks: 0,
      createdAt: nowStr,
      updatedAt: nowStr
    };

    await adCampaignsStore.setItem(duplicatedId, duplicated);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "ad_campaigns",
      operation: "INSERT",
      payloadId: duplicatedId,
      payload: duplicated,
      timestamp: Date.now()
    });

    setCampaigns([duplicated, ...campaigns]);
  };

  return (
    <div className="flex flex-col gap-5 w-full p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 w-full border-b border-white/5 pb-4">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wider">Campañas de Publicidad</h2>
          <p className="text-xs text-white/50">Crea y administra anuncios de patrocinadores para cuentas gratuitas y PRO.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={async () => {
              if (confirm("¿Estás seguro de que deseas reiniciar el historial de visualizaciones de anuncios en este dispositivo? Esto limpiará el registro local de límites diarios y frecuencias para que vuelvas a ver los popups y notificaciones de inmediato.")) {
                const { adImpressionsStore } = await import("@/lib/db/indexedDB");
                await adImpressionsStore.clear();
                alert("¡Historial de visualizaciones e impresiones de anuncios limpiado con éxito!");
              }
            }}
            className="py-2.5 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-1.5 cursor-pointer transition"
          >
            <span>Limpiar Impresiones</span>
          </button>
          <button
            onClick={handleOpenCreateModal}
            className="py-2.5 px-4 bg-cyan-neon text-black font-black text-xs uppercase tracking-wider rounded-2xl flex items-center gap-1.5 shadow-glow-cyan cursor-pointer transition hover:scale-102"
          >
            <Plus size={14} />
            <span>Nueva Campaña</span>
          </button>
        </div>
      </div>

      {/* Campaign List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
        {campaigns.map((camp) => (
          <motion.div
            key={camp.id}
            className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-5 flex flex-col justify-between hover:border-white/20 transition-all duration-300 shadow-xl relative"
          >
            {/* Status indicator */}
            <div className="absolute top-4 right-4">
              <span className={`text-[9px] px-2 py-0.5 rounded-full font-black border flex items-center gap-1.5 uppercase ${
                camp.status === "active"
                  ? "bg-green-500/10 text-green-400 border-green-500/20"
                  : "bg-yellow-gold/10 text-yellow-gold border-yellow-gold/20"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${camp.status === "active" ? "bg-green-400" : "bg-yellow-gold"}`} />
                {camp.status === "active" ? "Activa" : "Pausada"}
              </span>
            </div>

            <div>
              {/* Type Badge */}
              <span className="text-[8px] font-black uppercase tracking-widest text-cyan-neon bg-cyan-brand/20 px-2 py-0.5 rounded-md border border-cyan-neon/10">
                {camp.type === "popup" ? "Popup Modal" : camp.type === "banner_widget" ? "Banner Widget" : "Barra Notificación"}
              </span>

              <h3 className="text-xs font-bold text-white mt-3 truncate max-w-[70%]">{camp.name}</h3>
              
              {/* Dates */}
              <div className="flex items-center gap-1 text-[10px] text-white/40 mt-1">
                <Calendar size={12} />
                <span>{camp.startDate} al {camp.endDate}</span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 bg-neutral-950/40 border border-white/5 rounded-xl p-2.5 mt-4">
                <div>
                  <span className="text-[8px] text-white/30 uppercase font-bold block">Impresiones</span>
                  <span className="text-xs font-black text-white">{camp.totalImpressions || 0}</span>
                </div>
                <div>
                  <span className="text-[8px] text-white/30 uppercase font-bold block">Clics</span>
                  <span className="text-xs font-black text-white">{camp.totalClicks || 0}</span>
                </div>
                <div>
                  <span className="text-[8px] text-white/30 uppercase font-bold block">CTR</span>
                  <span className="text-xs font-black text-cyan-neon">
                    {camp.totalImpressions > 0 
                      ? `${((camp.totalClicks / camp.totalImpressions) * 100).toFixed(1)}%`
                      : "0.0%"}
                  </span>
                </div>
              </div>

              {/* Config Details */}
              <div className="mt-3.5 bg-neutral-950/20 border border-white/5 rounded-xl p-2.5 flex flex-col gap-1.5 text-[10px]">
                <div className="flex justify-between items-center text-white/40">
                  <span>Frecuencia:</span>
                  <span className="font-bold text-white/80">
                    {camp.frequencyMinutes > 0 ? `${camp.frequencyMinutes} min` : "Al abrir app"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-white/40">
                  <span>Límite diario:</span>
                  <span className="font-bold text-white/80">{camp.maxImpressionsPerDay} imp</span>
                </div>
                {camp.type === "popup" && (
                  <div className="flex justify-between items-center text-white/40">
                    <span>Mostrar al abrir:</span>
                    <span className="font-bold text-white/80">{camp.showOnAppOpen ? "Sí" : "No"}</span>
                  </div>
                )}
                {camp.type === "banner_widget" && (
                  <div className="flex justify-between items-center text-white/40">
                    <span>Transición:</span>
                    <span className="font-bold text-white/80">{camp.slideIntervalSeconds || 5} s</span>
                  </div>
                )}
                <div className="flex justify-between items-start text-white/40">
                  <span>Pantallas:</span>
                  <span className="font-bold text-white/80 text-[9px] max-w-[65%] text-right truncate" title={camp.targetScreens.join(", ")}>
                    {camp.targetScreens.join(", ")}
                  </span>
                </div>
                <div className="flex justify-between items-center text-white/40">
                  <span>Roles:</span>
                  <span className="font-bold text-white/80 uppercase text-[9px]">
                    {camp.targetRoles.map(r => r === "archer" ? "Arq" : "Coach").join(", ")}
                  </span>
                </div>
                <div className="flex justify-between items-center text-white/40">
                  <span>Planes:</span>
                  <span className="font-bold text-white/80 uppercase text-[9px]">
                    {(camp.targetPlans || ["FREE"]).join(", ")}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex justify-end gap-1.5 border-t border-white/5 pt-3.5 mt-4">
              <button
                onClick={() => handleToggleStatus(camp)}
                className={`p-2 rounded-xl text-white/70 hover:text-white transition cursor-pointer flex items-center justify-center border border-white/5 ${
                  camp.status === "active" ? "bg-yellow-gold/10 hover:bg-yellow-gold/20" : "bg-green-500/10 hover:bg-green-500/20"
                }`}
                title={camp.status === "active" ? "Pausar Campaña" : "Reanudar Campaña"}
              >
                {camp.status === "active" ? <Pause size={12} /> : <Play size={12} fill="white" />}
              </button>
              <button
                onClick={() => handleOpenEditModal(camp)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/5 transition cursor-pointer"
                title="Editar"
              >
                <Edit2 size={12} />
              </button>
              <button
                onClick={() => handleDuplicateCampaign(camp)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/5 transition cursor-pointer"
                title="Duplicar"
              >
                <Copy size={12} />
              </button>
              <button
                onClick={() => handleDeleteCampaign(camp.id)}
                className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/10 transition cursor-pointer"
                title="Eliminar"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Creation/Editing Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setShowCreateModal(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-6 w-full max-w-lg shadow-2xl z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            >
              {/* Modal Title & Step Indicators */}
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    {editingCampaignId ? "Editar Campaña" : "Crear Campaña"}
                  </h3>
                  <span className="text-[9px] text-cyan-neon font-black uppercase tracking-widest block mt-0.5">Paso {step} de 5</span>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="p-1 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* STEP 1: SELECT TYPE */}
              {step === 1 && (
                <div className="flex flex-col gap-4 py-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Nombre de la Campaña</label>
                    <input
                      type="text"
                      placeholder="Ej. Campaña Invierno Hoyt 2026"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                    />
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Formato de Anuncio</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: "popup", label: "Popup Modal", desc: "Pantalla completa al abrir la app" },
                        { id: "banner_widget", label: "Banner Widget", desc: "Debajo del Header, dinámico" },
                        { id: "notification_bar", label: "Barra Superior", desc: "Mensaje marquesina delgada" }
                      ].map((t) => (
                        <div
                          key={t.id}
                          onClick={() => setType(t.id as any)}
                          className={`border rounded-2xl p-4 cursor-pointer flex flex-col justify-between aspect-square text-center transition-all ${
                            type === t.id
                              ? "bg-cyan-brand/20 border-cyan-neon shadow-[0_0_15px_rgba(0,191,255,0.1)]"
                              : "bg-neutral-900/40 border-white/10 hover:border-white/20"
                          }`}
                        >
                          <span className="text-[10px] font-black text-white block truncate uppercase">{t.label}</span>
                          <span className="text-[8px] text-white/40 font-medium block leading-tight mt-2">{t.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: SLIDES EDITOR */}
              {step === 2 && (
                <div className="flex flex-col gap-3 py-2 max-h-[50vh] overflow-y-auto pr-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">Edición de Slides ({slides.length})</span>
                    <button
                      type="button"
                      onClick={handleAddSlide}
                      className="text-[9px] bg-white/5 hover:bg-white/10 text-cyan-neon border border-cyan-neon/20 px-2.5 py-1 rounded-lg font-bold"
                    >
                      + Agregar Slide
                    </button>
                  </div>

                  {slides.map((slide, idx) => (
                    <div key={slide.id} className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-2 relative">
                      {slides.length > 1 && (
                        <button
                          onClick={() => handleRemoveSlide(slide.id)}
                          className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition"
                          title="Eliminar Slide"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}

                      <span className="text-[8px] font-black text-white/30 uppercase">Slide #{idx + 1}</span>

                      <div className="grid grid-cols-2 gap-2">
                        {type !== "notification_bar" && (
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">URL Imagen</label>
                            <input
                              type="text"
                              placeholder="https://..."
                              value={slide.imageUrl}
                              onChange={(e) => handleUpdateSlideField(slide.id, "imageUrl", e.target.value)}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[10px] outline-none"
                            />
                          </div>
                        )}
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] text-white/40 uppercase font-bold">Enlace de Destino (Destoy URL)</label>
                          <input
                            type="text"
                            placeholder="https://..."
                            value={slide.linkUrl}
                            onChange={(e) => handleUpdateSlideField(slide.id, "linkUrl", e.target.value)}
                            className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[10px] outline-none"
                          />
                        </div>
                        {type !== "notification_bar" && (
                          <>
                            <div className="flex flex-col gap-0.5">
                              <label className="text-[8px] text-white/40 uppercase font-bold">Título</label>
                              <input
                                type="text"
                                placeholder="Título superpuesto"
                                value={slide.title}
                                onChange={(e) => handleUpdateSlideField(slide.id, "title", e.target.value)}
                                className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[10px] outline-none"
                              />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <label className="text-[8px] text-white/40 uppercase font-bold">Subtítulo</label>
                              <input
                                type="text"
                                placeholder="Subtítulo secundario"
                                value={slide.subtitle}
                                onChange={(e) => handleUpdateSlideField(slide.id, "subtitle", e.target.value)}
                                className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[10px] outline-none"
                              />
                            </div>
                          </>
                        )}
                        {type === "notification_bar" && (
                          <div className="col-span-2 flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Texto de la Barra</label>
                            <input
                              type="text"
                              placeholder="Ej. Evento Especial de Tiro con Arco..."
                              value={slide.title}
                              onChange={(e) => handleUpdateSlideField(slide.id, "title", e.target.value)}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[10px] outline-none"
                            />
                          </div>
                        )}
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] text-white/40 uppercase font-bold">Color de Fondo (Opcional)</label>
                          <input
                            type="text"
                            placeholder="Ej. #00BFFF"
                            value={slide.backgroundColor}
                            onChange={(e) => handleUpdateSlideField(slide.id, "backgroundColor", e.target.value)}
                            className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[10px] outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* STEP 3: SCHEDULE & GENERAL SETTINGS */}
              {step === 3 && (
                <div className="flex flex-col gap-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Fecha Inicio</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Fecha Fin</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 bg-neutral-950/40 p-4 border border-white/5 rounded-2xl mt-1">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] text-white/50 uppercase font-bold">Max Impresiones Diario</label>
                      <input
                        type="number"
                        value={maxImpressionsPerDay}
                        onChange={(e) => setMaxImpressionsPerDay(Number(e.target.value))}
                        className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] text-white/50 uppercase font-bold">Frecuencia (Minutos)</label>
                      <input
                        type="number"
                        value={frequencyMinutes}
                        onChange={(e) => setFrequencyMinutes(Number(e.target.value))}
                        className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs outline-none"
                        placeholder="0 = Solo abrir app"
                      />
                    </div>
                    {(type === "banner_widget" || type === "notification_bar") && (
                      <div className="flex flex-col gap-1 col-span-2">
                        <label className="text-[9px] text-white/50 uppercase font-bold">Intervalo de Transición (Segundos)</label>
                        <input
                          type="number"
                          value={slideIntervalSeconds}
                          onChange={(e) => setSlideIntervalSeconds(Number(e.target.value))}
                          className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs outline-none"
                        />
                      </div>
                    )}
                    
                    <div className="flex justify-between items-center col-span-2 bg-cyan-brand/10 border border-cyan-neon/20 p-2.5 rounded-xl text-[10px] mt-1">
                      <span className="text-white/70">¿Probando en tiempo real? Configura valores para testeo:</span>
                      <button
                        type="button"
                        onClick={() => {
                          setFrequencyMinutes(0);
                          setMaxImpressionsPerDay(999);
                        }}
                        className="px-2.5 py-1 bg-cyan-neon text-black font-black uppercase rounded-lg hover:scale-102 transition cursor-pointer text-[9px]"
                      >
                        Valores de Prueba
                      </button>
                    </div>
                  </div>

                  {type === "popup" && (
                    <div className="flex items-center justify-between bg-neutral-950/40 p-3.5 border border-white/5 rounded-2xl">
                      <div>
                        <span className="text-xs font-bold text-white block">Mostrar al abrir app</span>
                        <span className="text-[9px] text-white/40 block">Desplegar en el inicio de sesión.</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={showOnAppOpen}
                        onChange={(e) => setShowOnAppOpen(e.target.checked)}
                        className="w-4 h-4 accent-cyan-neon"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* STEP 4: TARGETING */}
              {step === 4 && (
                <div className="flex flex-col gap-4 py-2">
                  <div className="flex flex-col gap-2">
                    <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Pantallas Autorizadas</label>
                    <div className="grid grid-cols-2 gap-2 bg-neutral-950/40 p-3 rounded-2xl border border-white/5">
                      {["HOME", "TARGET", "HISTORY", "CALENDAR", "PROFILE"].map((screen) => (
                        <div
                          key={screen}
                          onClick={() => handleToggleScreen(screen)}
                          className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition ${
                            targetScreens.includes(screen)
                              ? "bg-cyan-brand/10 border-cyan-neon text-white"
                              : "bg-neutral-900 border-white/5 text-white/50"
                          }`}
                        >
                          <span className="text-xs font-bold">{screen}</span>
                          <input
                            type="checkbox"
                            checked={targetScreens.includes(screen)}
                            readOnly
                            className="w-3.5 h-3.5 accent-cyan-neon"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Roles Destinatarios</label>
                    <div className="flex gap-3 bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5">
                      {["archer", "coach"].map((role) => (
                        <div
                          key={role}
                          onClick={() => handleToggleRole(role as any)}
                          className={`flex-1 flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition ${
                            targetRoles.includes(role as any)
                              ? "bg-cyan-brand/10 border-cyan-neon text-white"
                              : "bg-neutral-900 border-white/5 text-white/50"
                          }`}
                        >
                          <span className="text-xs font-bold uppercase">{role === "archer" ? "Arquero" : "Coach"}</span>
                          <input
                            type="checkbox"
                            checked={targetRoles.includes(role as any)}
                            readOnly
                            className="w-3.5 h-3.5 accent-cyan-neon"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Planes de Suscripción Objetivos</label>
                    <div className="flex gap-3 bg-neutral-950/40 p-3.5 rounded-2xl border border-white/5">
                      {["FREE", "PRO"].map((plan) => {
                        const active = targetPlans.includes(plan as any);
                        return (
                          <div
                            key={plan}
                            onClick={() => {
                              if (active) {
                                setTargetPlans(targetPlans.filter((p) => p !== plan));
                              } else {
                                setTargetPlans([...targetPlans, plan as any]);
                              }
                            }}
                            className={`flex-1 flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition ${
                              active
                                ? "bg-cyan-brand/10 border-cyan-neon text-white"
                                : "bg-neutral-900 border-white/5 text-white/50"
                            }`}
                          >
                            <span className="text-xs font-bold uppercase">{plan === "FREE" ? "Gratuito (FREE)" : "Premium (PRO)"}</span>
                            <input
                              type="checkbox"
                              checked={active}
                              readOnly
                              className="w-3.5 h-3.5 accent-cyan-neon"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 5: PREVIEW */}
              {step === 5 && (
                <div className="flex flex-col gap-3 py-2">
                  <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">Vista Previa del Anuncio</span>
                  
                  <div className="border border-white/10 rounded-3xl p-4 bg-neutral-950/80 aspect-video flex items-center justify-center relative overflow-hidden">
                    {/* Mockup for Popup */}
                    {type === "popup" && (
                      <div className="w-4/5 aspect-[4/5] bg-[#0E0E12] border border-white/15 rounded-2xl relative shadow-2xl flex flex-col justify-between overflow-hidden">
                        <div className="absolute top-2 right-2 text-[7px] bg-black/60 px-1.5 py-0.5 rounded text-white/60">Cerrar en 3s</div>
                        <div 
                          className="flex-1 bg-cover bg-center" 
                          style={{ backgroundImage: `url(${slides[0]?.imageUrl || "https://images.unsplash.com/photo-1511379938547-c1f69419868d?q=80&w=600&auto=format&fit=crop"})` }} 
                        />
                        <div className="p-3 bg-[#0F0F12] border-t border-white/5">
                          <h4 className="text-[10px] font-black text-white">{slides[0]?.title || "Título del Anuncio"}</h4>
                          <p className="text-[8px] text-white/40">{slides[0]?.subtitle || "Subtítulo secundario..."}</p>
                        </div>
                      </div>
                    )}

                    {/* Mockup for Banner Widget */}
                    {type === "banner_widget" && (
                      <div className="w-full h-14 bg-[#0E0E12] border border-cyan-neon/30 rounded-xl relative flex items-center justify-between px-3 overflow-hidden">
                        <div 
                          className="absolute inset-0 bg-cover bg-center opacity-40" 
                          style={{ backgroundImage: `url(${slides[0]?.imageUrl || "https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?q=80&w=800&auto=format&fit=crop"})` }} 
                        />
                        <div className="relative z-10 flex flex-col justify-center max-w-[80%]">
                          <span className="text-[6px] font-black text-cyan-neon tracking-widest block uppercase">Patrocinador</span>
                          <span className="text-[9px] font-bold text-white truncate">{slides[0]?.title || "Título del Banner"}</span>
                        </div>
                        <span className="text-[7px] text-white/50">✕</span>
                      </div>
                    )}

                    {/* Mockup for Notification Bar */}
                    {type === "notification_bar" && (
                      <div 
                        style={slides[0]?.backgroundColor ? { backgroundColor: slides[0]?.backgroundColor } : { backgroundImage: "linear-gradient(to right, #00BFFF, #00E5FF)" }}
                        className="w-full h-6 rounded-lg relative flex items-center justify-between px-3 overflow-hidden text-black font-black text-[8px]"
                      >
                        <span className="truncate">{slides[0]?.title || "Notificación de Alerta de Publicidad..."}</span>
                        <span>✕</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Navigation Actions */}
              <div className="flex gap-2.5 border-t border-white/5 pt-4 mt-2">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep(step - 1)}
                    className="flex-1 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase flex items-center justify-center gap-1 cursor-pointer border border-white/5"
                  >
                    <ArrowLeft size={14} />
                    <span>Atrás</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-2.5 rounded-2xl bg-transparent border border-white/5 text-white/40 hover:text-white font-bold text-xs uppercase"
                  >
                    Cancelar
                  </button>
                )}

                {step < 5 ? (
                  <button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    className="flex-1 py-2.5 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase flex items-center justify-center gap-1 shadow-glow-cyan cursor-pointer"
                  >
                    <span>Siguiente</span>
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveCampaign}
                    className="flex-1 py-2.5 rounded-2xl bg-green-500 text-white font-black text-xs uppercase shadow-[0_0_15px_rgba(34,197,94,0.3)] flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Sparkles size={14} />
                    <span>Guardar Campaña</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
