"use client";

import React, { useState, useRef, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { Macrocycle } from "@/lib/db/macrocycleTypes";
import { 
  saveLocalMacrocycle, 
  generateResilientId, 
  addToSyncQueue,
  getLocalSetting 
} from "@/lib/db/indexedDB";
import { 
  saveDailyEntriesToCalendar, 
  syncEntireMacrocycleToCalendar, 
  SyncCycleSummary 
} from "@/lib/cycleCalendarSync";
import { 
  parseSpreadsheetData, 
  ParsedCycleResult, 
  ParsedDailyEntry,
  downloadSampleTemplate, 
  downloadDailySampleTemplate,
  fetchGoogleSheetCsv
} from "@/lib/cycleImporter";
import { 
  FileSpreadsheet, 
  UploadCloud, 
  ClipboardPaste, 
  Download, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Calendar, 
  Flame, 
  Target, 
  Table as TableIcon, 
  LayoutList, 
  Layers, 
  Link2, 
  RefreshCw, 
  Info, 
  ArrowRight,
  ShieldAlert,
  FileCheck2,
  Users,
  User
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface PlanImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  onSuccess: (result: {
    macrocycle: Macrocycle;
    summary: SyncCycleSummary;
  }) => void;
  titleOverride?: string;
}

type UploadTab = "paste" | "file" | "sheets";
type PreviewViewMode = "table" | "cards";

export default function PlanImporterModal({
  isOpen,
  onClose,
  user,
  onSuccess,
  titleOverride
}: PlanImporterModalProps) {
  const [activeTab, setActiveTab] = useState<UploadTab>("paste");
  const [importText, setImportText] = useState("");
  const [importPlanName, setImportPlanName] = useState("");
  const [importPreview, setImportPreview] = useState<ParsedCycleResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [sheetUrlInput, setSheetUrlInput] = useState("");
  const [isFetchingSheet, setIsFetchingSheet] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<PreviewViewMode>("table");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Recipient assignment state (Coach role)
  const [assignTarget, setAssignTarget] = useState<"all" | "single">("all");
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>("");
  const [clubAthletes, setClubAthletes] = useState<UserProfile[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadClubAthletes() {
      if (user.role !== "coach") return;
      try {
        const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
        let athletes = (allUsers || []).filter((u) => u.clubId === user.clubId && u.role === "archer");
        if (athletes.length === 0) {
          athletes = [
            {
              uid: "USR-ATHLETE-DANIELA",
              email: "daniela@archery101010.com",
              fullName: "Daniela Rivas",
              nickname: "daniela",
              birthDate: "2000-08-12",
              country: "CR",
              city: "San José",
              gender: "F",
              bowConfig: { type: "Recurve", brand: "Win&Win", model: "Wiawis", poundage: 38, defaultDistance: 70 },
              physicalData: { height: 168, weight: 58, dominantEye: "R", dominantHand: "R" },
              clubId: user.clubId || "CLB-DEMO",
              clubName: user.clubName || "Club Deportivo",
              role: "archer",
              plan: "FREE",
              isClubCreator: false
            },
            {
              uid: "USR-ATHLETE-CARLOS",
              email: "carlos@archery101010.com",
              fullName: "Carlos Mendoza",
              nickname: "carlosm",
              birthDate: "1998-04-25",
              country: "CR",
              city: "Cartago",
              gender: "M",
              bowConfig: { type: "Compound", brand: "Hoyt", model: "Stratum", poundage: 58, defaultDistance: 50 },
              physicalData: { height: 175, weight: 74, dominantEye: "R", dominantHand: "R" },
              clubId: user.clubId || "CLB-DEMO",
              clubName: user.clubName || "Club Deportivo",
              role: "archer",
              plan: "FREE",
              isClubCreator: false
            }
          ];
        }
        setClubAthletes(athletes);
        if (athletes.length > 0 && !selectedAthleteId) {
          setSelectedAthleteId(athletes[0].uid);
        }
      } catch (err) {
        console.error("Error loading club athletes in PlanImporterModal:", err);
      }
    }
    loadClubAthletes();
  }, [user.clubId, user.role, isOpen]);

  if (!isOpen) return null;

  const handleParseText = (text: string, nameOverride?: string) => {
    setImportText(text);
    setImportError(null);

    const clean = text.trim();
    if (!clean) {
      setImportPreview(null);
      return;
    }

    if (clean.toLowerCase().includes("offline mode active") || clean.toLowerCase().includes("connect to the internet")) {
      setImportPreview(null);
      setImportError("No hay conexión a internet para cargar el documento.");
      return;
    }

    const fallbackName = nameOverride !== undefined ? nameOverride : (importPlanName || "Plan de Entrenamiento 2026");
    const result = parseSpreadsheetData(clean, fallbackName);

    if (result.success && (result.stages.length > 0 || result.dailyEntries.length > 0)) {
      setImportPreview(result);
      if (!importPlanName && !nameOverride) {
        setImportPlanName(result.planName);
      }
    } else {
      setImportPreview(null);
      setImportError(result.error || "No se detectaron columnas válidas. Copia las celdas directamente de tu Excel o Google Sheets.");
    }
  };

  const handlePasteClipboard = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setUploadedFileName(null);
          handleParseText(text);
          return;
        }
      }
      alert("Copia las celdas de tu hoja (Ctrl+C o Copiar) y pégalas directamente en el recuadro.");
    } catch {
      alert("Tu navegador bloqueó el portapapeles automático. Pega las celdas manualmente en el recuadro.");
    }
  };

  const handleFileChange = (file?: File | null) => {
    if (!file) return;
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        const defaultName = file.name.replace(/\.[^/.]+$/, "");
        setImportPlanName(defaultName);
        handleParseText(content, defaultName);
      }
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileChange(file);
    }
  };

  const handleFetchGoogleSheets = async () => {
    if (!sheetUrlInput.trim()) return;
    setIsFetchingSheet(true);
    setImportError(null);
    try {
      const res = await fetchGoogleSheetCsv(sheetUrlInput);
      setIsFetchingSheet(false);
      if (res.ok && res.csv) {
        setUploadedFileName("Google Sheets Vinculado");
        handleParseText(res.csv);
      } else {
        setImportError(res.error || "No se pudo leer la hoja de Google Sheets. Asegúrate de que esté configurada como pública.");
      }
    } catch {
      setIsFetchingSheet(false);
      setImportError("Error al conectar con Google Sheets.");
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setIsSubmitting(true);

    try {
      const nowStr = new Date().toISOString();
      const planId = generateResilientId("MAC");
      const finalName = (importPlanName.trim() || importPreview.planName || "Plan de Entrenamiento").trim();

      const isCoach = user.role === "coach";
      const isSingle = isCoach && assignTarget === "single" && Boolean(selectedAthleteId);
      const targetAthletes = isSingle ? [selectedAthleteId] : (user.role === "archer" ? [user.uid] : []);
      const assignmentType: "club" | "individual" = (isSingle || user.role === "archer") ? "individual" : "club";

      const newCycle: Macrocycle = {
        id: planId,
        name: finalName,
        coachId: isCoach ? user.uid : "USR-COACH-DEFAULT",
        clubId: user.clubId || "CLB-DEMO",
        startDate: importPreview.startDate,
        endDate: importPreview.endDate,
        phases: importPreview.stages,
        assignmentType,
        assignedAthleteIds: targetAthletes,
        volumeGoal: importPreview.totalVolumeGoal,
        currentVolume: 0,
        status: "active",
        createdAt: nowStr,
        updatedAt: nowStr
      };

      await saveLocalMacrocycle(planId, newCycle);

      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "macrocycles",
        operation: "INSERT",
        payloadId: planId,
        payload: newCycle,
        timestamp: Date.now()
      });

      let summary: SyncCycleSummary;
      if (importPreview.mode === "daily" && importPreview.dailyEntries.length > 0) {
        summary = await saveDailyEntriesToCalendar(importPreview.dailyEntries, newCycle, user);
      } else {
        summary = await syncEntireMacrocycleToCalendar(newCycle, user);
      }

      onSuccess({
        macrocycle: newCycle,
        summary
      });
      onClose();
    } catch (err) {
      console.error("Error confirming plan import:", err);
      setImportError("Ocurrió un error al guardar el plan. Por favor intenta de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Compute detailed statistics from preview
  const totalEntries = importPreview?.dailyEntries.length || 0;
  const trainingCount = importPreview?.dailyEntries.filter((d) => !d.isRestDay).length || importPreview?.stages.length || 0;
  const restCount = importPreview?.dailyEntries.filter((d) => d.isRestDay).length || 0;
  const totalArrows = importPreview?.totalVolumeGoal || 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fadeIn">
      <div className="absolute inset-0" onClick={() => !isSubmitting && onClose()} />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative bg-[#0A0A0C] border border-cyan-neon/30 rounded-3xl w-full max-w-2xl flex flex-col max-h-[92vh] shadow-[0_0_60px_rgba(0,229,255,0.08)] z-10 overflow-hidden text-left"
      >
        {/* Glow Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex justify-between items-start bg-gradient-to-r from-neutral-900/80 via-neutral-900/40 to-neutral-950">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-neon/15 border border-cyan-neon/30 flex items-center justify-center text-cyan-neon shadow-glow-cyan shrink-0">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <span className="text-[9px] text-cyan-neon uppercase font-black tracking-widest block">
                {titleOverride || "Gestión de Planes & Calendario"}
              </span>
              <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-wide">
                Subir Plan de Entrenamiento
              </h2>
              <p className="text-[11px] text-white/50 leading-tight mt-0.5">
                Carga tu Excel, Google Sheets o CSV con la estructura exacta de tu documento.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-xl bg-neutral-900 border border-white/10 text-white/40 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto flex-1">
          {/* Method Selection Tabs */}
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-neutral-900/80 rounded-2xl border border-white/5">
            <button
              type="button"
              onClick={() => setActiveTab("paste")}
              className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer ${
                activeTab === "paste"
                  ? "bg-gradient-to-r from-cyan-brand to-cyan-neon text-black shadow-glow-cyan"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <ClipboardPaste size={14} />
              <span>Pegar Celdas</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("file")}
              className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer ${
                activeTab === "file"
                  ? "bg-gradient-to-r from-cyan-brand to-cyan-neon text-black shadow-glow-cyan"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <UploadCloud size={14} />
              <span>Subir Archivo</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("sheets")}
              className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer ${
                activeTab === "sheets"
                  ? "bg-gradient-to-r from-cyan-brand to-cyan-neon text-black shadow-glow-cyan"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Link2 size={14} />
              <span>Google Sheets</span>
            </button>
          </div>

          {/* Quick Model Download Pill Buttons */}
          <div className="flex items-center justify-between text-[10px] text-white/50 px-1 flex-wrap gap-2">
            <span className="flex items-center gap-1 font-bold">
              <Info size={12} className="text-cyan-neon" />
              <span>Plantillas de referencia:</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadDailySampleTemplate}
                className="text-[10px] text-white/70 hover:text-cyan-neon flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 hover:border-cyan-neon/30 transition"
              >
                <Download size={11} className="text-cyan-neon" />
                <span>Modelo Día x Día (.csv)</span>
              </button>
              <button
                type="button"
                onClick={downloadSampleTemplate}
                className="text-[10px] text-white/70 hover:text-purple-300 flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 hover:border-purple-400/30 transition"
              >
                <Download size={11} className="text-purple-400" />
                <span>Modelo Etapas (.csv)</span>
              </button>
            </div>
          </div>

          {/* TAB 1: PASTE CELLS */}
          {activeTab === "paste" && (
            <div className="flex flex-col gap-3 animate-fadeIn">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/60">
                  Copia las filas en Excel o Sheets y pégalas aquí:
                </span>
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="px-3 py-1.5 rounded-xl bg-cyan-neon/10 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 transition active:scale-95 shadow-sm cursor-pointer"
                >
                  <ClipboardPaste size={13} />
                  <span>Pegar desde Portapapeles</span>
                </button>
              </div>

              <textarea
                value={importText}
                onChange={(e) => handleParseText(e.target.value)}
                placeholder={`Formato Día por Día recomendado:\nFecha\tActividad\tFlechas\tEnfoque\tNotas\n26/10/2026\tVolumen 70m\t120\tAnclaje firme\tSeries de 6 flechas\n27/10/2026\tControl WA 720\t144\tTiempo oficial\tAnotar en la app\n28/10/2026\tDescanso\t0\t\tRecuperación activa`}
                rows={5}
                className="bg-neutral-900/90 border border-white/10 rounded-2xl p-3.5 text-xs font-mono text-white/90 outline-none focus:border-cyan-neon transition placeholder:text-white/20 resize-none leading-relaxed"
              />
            </div>
          )}

          {/* TAB 2: DRAG & DROP FILE */}
          {activeTab === "file" && (
            <div className="flex flex-col gap-3 animate-fadeIn">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`p-6 sm:p-8 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 text-center transition cursor-pointer ${
                  isDraggingFile
                    ? "border-cyan-neon bg-cyan-neon/10 scale-[1.01]"
                    : "border-white/15 bg-neutral-900/40 hover:border-cyan-neon/40 hover:bg-neutral-900/80"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={(e) => handleFileChange(e.target.files?.[0])}
                  className="hidden"
                />

                <div className="w-12 h-12 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/20 flex items-center justify-center text-cyan-neon">
                  <UploadCloud size={24} />
                </div>

                <div>
                  <h4 className="text-sm font-black text-white uppercase tracking-wide">
                    {uploadedFileName ? uploadedFileName : "Arrastra tu archivo aquí o haz clic para examinar"}
                  </h4>
                  <p className="text-xs text-white/50 mt-1">
                    Formatos compatibles: <strong className="text-cyan-neon">.CSV</strong>, <strong className="text-cyan-neon">.TSV</strong> o archivo de texto de Excel
                  </p>
                </div>

                <span className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 font-bold text-[10px] uppercase tracking-wider">
                  Seleccionar Archivo de tu Dispositivo
                </span>
              </div>
            </div>
          )}

          {/* TAB 3: GOOGLE SHEETS */}
          {activeTab === "sheets" && (
            <div className="flex flex-col gap-3 animate-fadeIn">
              <div className="bg-neutral-900/40 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
                <label className="text-[10px] text-white/70 uppercase font-black tracking-wider flex items-center gap-1.5">
                  <Link2 size={13} className="text-cyan-neon" />
                  <span>Enlace Compartido de Google Sheets</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={sheetUrlInput}
                    onChange={(e) => setSheetUrlInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/..."
                    className="flex-1 bg-neutral-950 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition placeholder:text-white/20 min-w-0"
                  />
                  <button
                    type="button"
                    disabled={!sheetUrlInput.trim() || isFetchingSheet}
                    onClick={handleFetchGoogleSheets}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-black text-xs uppercase tracking-wider shrink-0 transition disabled:opacity-40 cursor-pointer shadow-glow-cyan flex items-center gap-1.5"
                  >
                    {isFetchingSheet ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Conectando...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw size={13} />
                        <span>Conectar & Leer</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-start gap-2 bg-neutral-950/60 p-2.5 rounded-xl border border-white/5 text-[10px] text-white/60">
                  <Info size={14} className="text-cyan-neon shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Asegúrate de que en Google Sheets hayas pulsado <strong>Compartir</strong> y configurado el acceso en <strong>"Cualquier persona con el enlace (Lector)"</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Optional Plan Name Edit */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">
              Nombre Oficial del Plan
            </label>
            <input
              type="text"
              value={importPlanName}
              onChange={(e) => {
                setImportPlanName(e.target.value);
                if (importText.trim()) {
                  handleParseText(importText, e.target.value);
                }
              }}
              placeholder="Ej. Plan Mensual de Tiro - Noviembre 2026"
              className="bg-neutral-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-xs outline-none focus:border-cyan-neon transition placeholder:text-white/20 font-bold"
            />
          </div>

          {/* Error Message */}
          {importError && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs flex items-center gap-2.5 animate-fadeIn">
              <AlertCircle size={16} className="shrink-0" />
              <span className="leading-snug">{importError}</span>
            </div>
          )}

          {/* PARSED PREVIEW - HIGH LEVEL ORGANIZED DISPLAY */}
          {importPreview && (importPreview.dailyEntries.length > 0 || importPreview.stages.length > 0) && (
            <div className="flex flex-col gap-3.5 bg-neutral-950 border border-white/10 rounded-2xl p-4 shadow-xl animate-fadeIn">
              {/* Header with Mode Badge & View Switcher */}
              <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <FileCheck2 size={16} />
                  </span>
                  <div>
                    <span className="text-[10px] font-black uppercase text-emerald-400 tracking-wider block">
                      {importPreview.mode === "daily" ? "Plan Día por Día Detectado" : "Plan por Etapas Detectado"}
                    </span>
                    <span className="text-[11px] text-white/60 font-mono">
                      Rango: {importPreview.startDate} al {importPreview.endDate}
                    </span>
                  </div>
                </div>

                {/* View Switcher: Table vs Cards */}
                {importPreview.mode === "daily" && (
                  <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-white/5">
                    <button
                      type="button"
                      onClick={() => setViewMode("table")}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition ${
                        viewMode === "table"
                          ? "bg-cyan-neon text-black font-black"
                          : "text-white/60 hover:text-white"
                      }`}
                    >
                      <TableIcon size={12} />
                      <span>Tabla Original</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("cards")}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition ${
                        viewMode === "cards"
                          ? "bg-cyan-neon text-black font-black"
                          : "text-white/60 hover:text-white"
                      }`}
                    >
                      <LayoutList size={12} />
                      <span>Tarjetas</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 4 Key Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-neutral-900/60 p-2.5 rounded-xl border border-white/5">
                  <span className="text-[8px] text-white/40 uppercase font-black tracking-widest block">Días Totales</span>
                  <span className="text-xs font-black text-white mt-0.5 block">{totalEntries || importPreview.stages.length} días</span>
                </div>
                <div className="bg-neutral-900/60 p-2.5 rounded-xl border border-white/5">
                  <span className="text-[8px] text-white/40 uppercase font-black tracking-widest block">Entrenamientos</span>
                  <span className="text-xs font-black text-cyan-neon mt-0.5 block">{trainingCount} sesiones</span>
                </div>
                <div className="bg-neutral-900/60 p-2.5 rounded-xl border border-white/5">
                  <span className="text-[8px] text-white/40 uppercase font-black tracking-widest block">Descansos</span>
                  <span className="text-xs font-black text-emerald-400 mt-0.5 block">{restCount} días</span>
                </div>
                <div className="bg-neutral-900/60 p-2.5 rounded-xl border border-white/5">
                  <span className="text-[8px] text-white/40 uppercase font-black tracking-widest block">Flechas Totales</span>
                  <span className="text-xs font-black text-yellow-gold mt-0.5 block">{totalArrows.toLocaleString()}</span>
                </div>
              </div>

              {/* Coach Recipient Selector: Send to 1 athlete or all */}
              {user.role === "coach" && (
                <div className="p-3 sm:p-3.5 rounded-2xl bg-neutral-900/90 border border-cyan-neon/30 flex flex-col gap-2.5 shadow-[0_0_25px_rgba(0,229,255,0.06)]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-cyan-neon uppercase font-black tracking-widest flex items-center gap-1.5">
                      <Users size={13} className="text-cyan-neon" />
                      <span>Destinatario del Plan & Calendario</span>
                    </span>
                    <span className="text-[9px] text-white/60 font-bold uppercase tracking-wider bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                      {assignTarget === "all" ? "Todo el Club" : "1 Alumno"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAssignTarget("all")}
                      className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer border ${
                        assignTarget === "all"
                          ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon shadow-glow-cyan"
                          : "bg-neutral-950/70 border-white/10 text-white/40 hover:text-white"
                      }`}
                    >
                      <Users size={13} />
                      <span>Todos los Alumnos</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAssignTarget("single")}
                      className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer border ${
                        assignTarget === "single"
                          ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon shadow-glow-cyan"
                          : "bg-neutral-950/70 border-white/10 text-white/40 hover:text-white"
                      }`}
                    >
                      <User size={13} />
                      <span>1 Alumno Específico</span>
                    </button>
                  </div>

                  {assignTarget === "single" && (
                    <div className="flex flex-col gap-1.5 pt-1 animate-fadeIn">
                      <label className="text-[9px] text-white/60 uppercase font-black tracking-widest flex items-center gap-1">
                        <span>Selecciona el alumno de tu lista:</span>
                      </label>
                      <select
                        value={selectedAthleteId}
                        onChange={(e) => setSelectedAthleteId(e.target.value)}
                        className="bg-neutral-950 border border-cyan-neon/40 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon font-bold cursor-pointer"
                      >
                        {clubAthletes.map((ath) => (
                          <option key={ath.uid} value={ath.uid}>
                            {ath.fullName || ath.email} · {ath.bowConfig?.type || "Arquero"}
                          </option>
                        ))}
                      </select>
                      <span className="text-[10px] text-cyan-neon/80 italic">
                        El plan y sus tareas se sincronizarán únicamente en el calendario del alumno seleccionado.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* PREVIEW CONTAINER */}
              {importPreview.mode === "daily" ? (
                viewMode === "table" ? (
                  /* SPREADSHEET TABLE VIEW - IDENTICAL TO EXCEL/GOOGLE SHEETS */
                  <div className="rounded-xl border border-white/10 overflow-hidden bg-neutral-950 max-h-56 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead className="bg-neutral-900 sticky top-0 z-10 border-b border-white/10">
                        <tr>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white/50 w-10 text-center">#</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white/50">Fecha</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white/50">Actividad</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white/50 text-right">Flechas</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white/50">Enfoque</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white/50">Notas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono">
                        {importPreview.dailyEntries.map((row, idx) => (
                          <tr 
                            key={`${row.date}-${idx}`}
                            className={`hover:bg-white/[0.03] transition ${row.isRestDay ? "bg-emerald-500/[0.02]" : ""}`}
                          >
                            <td className="py-2 px-2.5 text-[10px] text-white/30 text-center">{idx + 1}</td>
                            <td className="py-2 px-2.5 text-white/90 whitespace-nowrap font-bold">{row.date}</td>
                            <td className="py-2 px-2.5 text-white">
                              <span className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.isRestDay ? "bg-emerald-400" : row.type === "competition" ? "bg-rose-400" : "bg-cyan-neon"}`} />
                                <span className="truncate max-w-[140px] font-sans font-medium">{row.title}</span>
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-right whitespace-nowrap">
                              {row.isRestDay ? (
                                <span className="text-emerald-400 text-[10px] font-bold">Descanso</span>
                              ) : (
                                <span className="text-cyan-neon font-black">{row.targetArrows}</span>
                              )}
                            </td>
                            <td className="py-2 px-2.5 text-white/60 font-sans truncate max-w-[120px]">
                              {row.focusPoints && row.focusPoints.length > 0 ? row.focusPoints.join(", ") : "-"}
                            </td>
                            <td className="py-2 px-2.5 text-white/60 font-sans italic truncate max-w-[140px]">
                              {row.notes ? row.notes : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* CARDS VIEW */
                  <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {importPreview.dailyEntries.map((dayItem, i) => (
                      <div
                        key={`${dayItem.date}-${i}`}
                        className="p-2.5 rounded-xl bg-neutral-900/60 border border-white/5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              dayItem.isRestDay ? "bg-emerald-400" : dayItem.type === "competition" ? "bg-rose-400" : "bg-cyan-neon"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-white truncate text-xs">{dayItem.title}</div>
                            <div className="text-[10px] text-white/50 font-mono truncate">
                              {dayItem.date} {dayItem.focusPoints && dayItem.focusPoints.length > 0 ? `· ${dayItem.focusPoints.join(", ")}` : ""}
                            </div>
                            {dayItem.notes && (
                              <div className="text-[10px] text-white/40 italic truncate mt-0.5">
                                "{dayItem.notes}"
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-cyan-neon font-black font-mono whitespace-nowrap text-xs">
                            {dayItem.isRestDay ? (
                              <span className="text-emerald-400">Descanso</span>
                            ) : (
                              `🎯 ${dayItem.targetArrows} fl`
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                /* STAGES VIEW */
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                  {importPreview.stages.map((stg, i) => (
                    <div
                      key={stg.id || i}
                      className="p-2.5 rounded-xl bg-neutral-900/60 border border-white/5 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: stg.color || "#00E5FF" }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-white truncate">{stg.name}</div>
                          <div className="text-[10px] text-white/40 font-mono">
                            {stg.startDate} al {stg.endDate} · {stg.weeklySessionGoal} sesiones/sem
                          </div>
                          {stg.notes && (
                            <div className="text-[10px] text-white/40 italic truncate mt-0.5">
                              "{stg.notes}"
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-cyan-neon font-black font-mono">
                          {stg.weeklyArrowGoal} fl/sem
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-neutral-950 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="py-2.5 px-4 rounded-xl bg-neutral-900 hover:bg-neutral-850 text-white/70 hover:text-white font-bold text-xs uppercase cursor-pointer transition border border-white/5"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={!importPreview || (importPreview.stages.length === 0 && importPreview.dailyEntries.length === 0) || isSubmitting}
            onClick={handleConfirmImport}
            className="flex-1 py-3 px-5 rounded-2xl bg-gradient-to-r from-cyan-brand via-cyan-neon to-emerald-400 hover:brightness-110 text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition shadow-glow-cyan disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer active:scale-98"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Vinculando Plan al Calendario...</span>
              </>
            ) : (
              <>
                <Sparkles size={15} />
                <span>
                  {user.role === "coach" && assignTarget === "single"
                    ? `Publicar y Enviar a ${clubAthletes.find(a => a.uid === selectedAthleteId)?.fullName || "Alumno"}`
                    : "Vincular y Publicar al Calendario"}
                </span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
