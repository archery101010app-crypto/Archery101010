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
  parseExcelWorkbookBuffer,
  ParsedCycleResult, 
  downloadSampleTemplate, 
  downloadDailySampleTemplate,
  fetchGoogleSheetCsv
} from "@/lib/cycleImporter";
import { 
  FileSpreadsheet, 
  UploadCloud, 
  ClipboardPaste, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Table as TableIcon, 
  LayoutList, 
  Link2, 
  RefreshCw, 
  Info, 
  ArrowRight,
  FileCheck2,
  Users,
  User,
  Check
} from "lucide-react";
import { motion } from "framer-motion";

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

type UploadTab = "file" | "sheets" | "paste";
type PreviewViewMode = "table" | "cards";

export default function PlanImporterModal({
  isOpen,
  onClose,
  user,
  onSuccess,
  titleOverride
}: PlanImporterModalProps) {
  const [activeTab, setActiveTab] = useState<UploadTab>("file");
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

  // Multi-sheet Excel workbook states
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedExcelSheet, setSelectedExcelSheet] = useState<string>("");
  const workbookExtractorRef = useRef<((sheetName: string) => string) | null>(null);

  // Recipient assignment state (Coach role)
  const [assignTarget, setAssignTarget] = useState<"all" | "single">("all");
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>("");
  const [clubAthletes, setClubAthletes] = useState<UserProfile[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadClubAthletes() {
      if (user.role !== "coach" && user.role !== "team_admin_coach") return;
      try {
        const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const athletes = (allUsers || []).filter((u) => u.clubId === user.clubId && u.role === "archer");
        setClubAthletes(athletes);
        if (athletes.length > 0 && !selectedAthleteId) {
          setSelectedAthleteId(athletes[0].uid);
        }
      } catch (err) {
        console.error("Error loading club athletes in PlanImporterModal:", err);
      }
    }
    loadClubAthletes();
  }, [user.clubId, user.role, isOpen, selectedAthleteId]);

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

    const fallbackName = nameOverride !== undefined ? nameOverride : (importPlanName || "Plan Importado");
    const result = parseSpreadsheetData(clean, fallbackName);

    if (result.success && (result.stages.length > 0 || result.dailyEntries.length > 0)) {
      setImportPreview(result);
      if (!importPlanName && !nameOverride) {
        setImportPlanName(result.planName);
      }
    } else {
      setImportPreview(null);
      setImportError(result.error || "No se detectaron fechas o filas válidas en el archivo. Revisa que tu hoja tenga una columna de Fecha o Día.");
    }
  };

  const handlePasteClipboard = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setUploadedFileName(null);
          setExcelSheets([]);
          handleParseText(text);
          return;
        }
      }
      alert("Copia las celdas de tu hoja (Ctrl+C o Copiar) y pégalas directamente en el recuadro.");
    } catch {
      alert("Pega las celdas manteniendo presionado dentro del recuadro de texto.");
    }
  };

  const handleFileChange = (file?: File | null) => {
    if (!file) return;
    setUploadedFileName(file.name);
    setImportError(null);

    const defaultName = file.name.replace(/\.[^/.]+$/, "");
    setImportPlanName(defaultName);

    const lowerName = file.name.toLowerCase();
    const isBinaryExcel = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".ods");

    if (isBinaryExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          if (!buffer) return;
          const { sheetNames, getSheetTsv } = parseExcelWorkbookBuffer(buffer);
          workbookExtractorRef.current = getSheetTsv;
          setExcelSheets(sheetNames);

          // Automatically pick the first non-empty sheet
          let chosenSheet = sheetNames[0] || "";
          let extractedTsv = "";
          for (const sName of sheetNames) {
            const candidate = getSheetTsv(sName);
            if (candidate && candidate.trim().length > 0) {
              chosenSheet = sName;
              extractedTsv = candidate;
              break;
            }
          }
          setSelectedExcelSheet(chosenSheet);
          handleParseText(extractedTsv, defaultName);
        } catch (err) {
          console.error("Error parsing Excel file:", err);
          setImportError("No se pudo leer el archivo Excel (.xlsx). Verifica que no esté protegido con contraseña.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      setExcelSheets([]);
      workbookExtractorRef.current = null;
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (content) {
          handleParseText(content, defaultName);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleSelectExcelSheet = (sheetName: string) => {
    setSelectedExcelSheet(sheetName);
    if (workbookExtractorRef.current) {
      const tsv = workbookExtractorRef.current(sheetName);
      handleParseText(tsv, importPlanName || sheetName);
    }
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
    setExcelSheets([]);
    try {
      const res = await fetchGoogleSheetCsv(sheetUrlInput);
      setIsFetchingSheet(false);
      if (res.ok && res.csv) {
        setUploadedFileName("Google Sheets Vinculado");
        handleParseText(res.csv, importPlanName || "Plan Google Sheets");
      } else {
        setImportError(res.error || "No se pudo leer la hoja de Google Sheets. Asegúrate de que esté configurada como 'Cualquier persona con el enlace puede ver'.");
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
      const finalName = (importPlanName.trim() || importPreview.planName || "Plan Importado").trim();

      const isCoach = user.role === "coach" || user.role === "team_admin_coach";
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
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fadeIn">
      <div className="absolute inset-0" onClick={() => !isSubmitting && onClose()} />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative bg-[#0A0B0E] border border-white/10 rounded-3xl w-full max-w-2xl flex flex-col max-h-[92vh] shadow-2xl z-10 overflow-hidden text-left"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex justify-between items-start bg-[#0D0F12]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/25 flex items-center justify-center text-cyan-neon shrink-0">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <span className="text-[9px] text-cyan-neon uppercase font-black tracking-widest block">
                {titleOverride || "Calendario y Planificación"}
              </span>
              <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-wide">
                Importar Excel o Google Sheets
              </h2>
              <p className="text-[11px] text-white leading-tight mt-0.5">
                Lectura 100% literal de tus fechas, actividades, flechas y columnas sin modificar tu texto.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-xl bg-neutral-900 border border-white/10 text-white hover:text-white hover:bg-neutral-800 transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto flex-1">
          {/* Method Selection Tabs */}
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#0D0F12] rounded-2xl border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setActiveTab("file")}
              className={`py-2 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === "file"
                  ? "bg-cyan-neon text-black"
                  : "text-white hover:text-white"
              }`}
            >
              <UploadCloud size={14} />
              <span>Subir Excel</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("sheets")}
              className={`py-2 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === "sheets"
                  ? "bg-cyan-neon text-black"
                  : "text-white hover:text-white"
              }`}
            >
              <Link2 size={14} />
              <span>Google Sheets</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("paste")}
              className={`py-2 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === "paste"
                  ? "bg-cyan-neon text-black"
                  : "text-white hover:text-white"
              }`}
            >
              <ClipboardPaste size={14} />
              <span>Pegar Celdas</span>
            </button>
          </div>

          {/* TAB 1: UPLOAD EXCEL (.XLSX / .XLS / .CSV) */}
          {activeTab === "file" && (
            <div className="flex flex-col gap-3 animate-fadeIn">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`p-5 sm:p-6 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2.5 text-center transition cursor-pointer ${
                  isDraggingFile
                    ? "border-cyan-neon bg-cyan-neon/10"
                    : "border-white/15 bg-[#0D0F12] hover:border-cyan-neon/40"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.ods,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={(e) => handleFileChange(e.target.files?.[0])}
                  className="hidden"
                />

                <div className="w-11 h-11 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/25 flex items-center justify-center text-cyan-neon">
                  <UploadCloud size={22} />
                </div>

                <div>
                  <h4 className="text-xs sm:text-sm font-black text-white uppercase tracking-wide">
                    {uploadedFileName ? uploadedFileName : "Toca aquí para elegir tu archivo Excel o CSV"}
                  </h4>
                  <p className="text-[11px] text-white mt-1">
                    Compatible con <strong className="text-cyan-neon">Excel (.xlsx, .xls)</strong> y <strong className="text-cyan-neon">.CSV</strong> directamente desde tu celular o PC
                  </p>
                </div>

                <span className="px-3.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-[10px] uppercase tracking-wider">
                  {uploadedFileName ? "Cambiar Archivo" : "Seleccionar Archivo"}
                </span>
              </div>

              {/* Multi-sheet selector if the Excel file has multiple tabs */}
              {excelSheets.length > 1 && (
                <div className="bg-[#0D0F12] border border-white/[0.08] rounded-2xl p-3 flex flex-col gap-2">
                  <span className="text-[9px] text-white uppercase font-black tracking-widest">
                    Pestañas detectadas en tu Excel ({excelSheets.length}) — Elige cuál aplicar:
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {excelSheets.map((sName) => (
                      <button
                        key={sName}
                        type="button"
                        onClick={() => handleSelectExcelSheet(sName)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border transition cursor-pointer ${
                          selectedExcelSheet === sName
                            ? "bg-cyan-neon text-black border-cyan-neon"
                            : "bg-neutral-900 border-white/10 text-white hover:text-white"
                        }`}
                      >
                        {sName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: GOOGLE SHEETS */}
          {activeTab === "sheets" && (
            <div className="flex flex-col gap-3 animate-fadeIn">
              <div className="bg-[#0D0F12] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-3">
                <label className="text-[10px] text-white uppercase font-black tracking-wider flex items-center gap-1.5">
                  <Link2 size={13} className="text-cyan-neon" />
                  <span>Enlace de Google Sheets</span>
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={sheetUrlInput}
                    onChange={(e) => setSheetUrlInput(e.target.value)}
                    placeholder="Pega aquí el enlace de tu Google Sheets..."
                    className="flex-1 bg-neutral-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-xs outline-none focus:border-cyan-neon transition placeholder:text-white min-w-0"
                  />
                  <button
                    type="button"
                    disabled={!sheetUrlInput.trim() || isFetchingSheet}
                    onClick={handleFetchGoogleSheets}
                    className="px-4 py-2.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider shrink-0 transition disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw size={13} className={isFetchingSheet ? "animate-spin" : ""} />
                    <span>{isFetchingSheet ? "Leyendo..." : "Leer Google Sheet"}</span>
                  </button>
                </div>

                <div className="flex items-start gap-2 bg-neutral-950/60 p-2.5 rounded-xl border border-white/5 text-[10px] text-white">
                  <Info size={14} className="text-cyan-neon shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    En la app de Google Sheets toca <strong>Compartir</strong> y asegúrate de que diga <strong>&ldquo;Cualquier persona con el enlace (Lector)&rdquo;</strong>, o usa la pestaña <strong>Pegar Celdas</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PASTE CELLS */}
          {activeTab === "paste" && (
            <div className="flex flex-col gap-2.5 animate-fadeIn">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-white">
                  Copia las celdas en Excel o Sheets y pégalas aquí:
                </span>
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="px-3 py-1.5 rounded-xl bg-cyan-neon/10 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                >
                  <ClipboardPaste size={13} />
                  <span>Pegar del Portapapeles</span>
                </button>
              </div>

              <textarea
                value={importText}
                onChange={(e) => handleParseText(e.target.value)}
                placeholder={`Ejemplo:\nFecha\tActividad\tFlechas\tNotas\n28/10/2026\tVolumen 70m\t120\tSeries de 6 flechas\n29/10/2026\tControl 720\t72\tAnotar en la app\n30/10/2026\tDescanso\t0\t`}
                rows={5}
                className="bg-[#0D0F12] border border-white/10 rounded-2xl p-3.5 text-xs font-mono text-white outline-none focus:border-cyan-neon transition placeholder:text-white resize-none leading-relaxed"
              />
            </div>
          )}

          {/* Quick Reference Templates */}
          <div className="flex items-center justify-between text-[10px] text-white px-1 flex-wrap gap-2">
            <span className="flex items-center gap-1 font-bold">
              <Info size={12} className="text-cyan-neon" />
              <span>Plantillas opcionales de ejemplo:</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadDailySampleTemplate}
                className="text-[10px] text-white hover:text-cyan-neon flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#0D0F12] border border-white/10 hover:border-cyan-neon/30 transition cursor-pointer"
              >
                <Download size={11} className="text-cyan-neon" />
                <span>Día x Día (.csv)</span>
              </button>
              <button
                type="button"
                onClick={downloadSampleTemplate}
                className="text-[10px] text-white hover:text-white flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#0D0F12] border border-white/10 hover:border-white/30 transition cursor-pointer"
              >
                <Download size={11} />
                <span>Por Etapas (.csv)</span>
              </button>
            </div>
          </div>

          {/* Optional Plan Name Edit */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-white uppercase font-black tracking-widest">
              Nombre del Plan
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
              placeholder="Ej. Plan Mensual Octubre - Noviembre"
              className="bg-[#0D0F12] border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-xs outline-none focus:border-cyan-neon transition placeholder:text-white font-bold"
            />
          </div>

          {/* Error Message */}
          {importError && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs flex items-center gap-2.5 animate-fadeIn">
              <AlertCircle size={16} className="shrink-0" />
              <span className="leading-snug">{importError}</span>
            </div>
          )}

          {/* PARSED PREVIEW - LITERAL DISPLAY */}
          {importPreview && (importPreview.dailyEntries.length > 0 || importPreview.stages.length > 0) && (
            <div className="flex flex-col gap-3.5 bg-[#0D0F12] border border-white/10 rounded-2xl p-4 animate-fadeIn">
              {/* Header with Mode Badge & View Switcher */}
              <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-white/[0.08]">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400">
                    <FileCheck2 size={16} />
                  </span>
                  <div>
                    <span className="text-[10px] font-black uppercase text-emerald-400 tracking-wider block">
                      {importPreview.mode === "daily" ? "Lectura Literal Día por Día Lista" : "Lectura Literal por Etapas Lista"}
                    </span>
                    <span className="text-[11px] text-white font-mono tabular-nums">
                      Del {importPreview.startDate} al {importPreview.endDate}
                    </span>
                  </div>
                </div>

                {/* View Switcher: Table vs Cards */}
                {importPreview.mode === "daily" && (
                  <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setViewMode("table")}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition cursor-pointer ${
                        viewMode === "table"
                          ? "bg-cyan-neon text-black font-black"
                          : "text-white hover:text-white"
                      }`}
                    >
                      <TableIcon size={12} />
                      <span>Tabla</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("cards")}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition cursor-pointer ${
                        viewMode === "cards"
                          ? "bg-cyan-neon text-black font-black"
                          : "text-white hover:text-white"
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
                <div className="bg-neutral-950 p-2.5 rounded-xl border border-white/[0.06]">
                  <span className="text-[8px] text-white uppercase font-black tracking-widest block">Días Leídos</span>
                  <span className="text-xs font-black text-white mt-0.5 block tabular-nums">{totalEntries || importPreview.stages.length} días</span>
                </div>
                <div className="bg-neutral-950 p-2.5 rounded-xl border border-white/[0.06]">
                  <span className="text-[8px] text-white uppercase font-black tracking-widest block">Actividades</span>
                  <span className="text-xs font-black text-cyan-neon mt-0.5 block tabular-nums">{trainingCount} días</span>
                </div>
                <div className="bg-neutral-950 p-2.5 rounded-xl border border-white/[0.06]">
                  <span className="text-[8px] text-white uppercase font-black tracking-widest block">Descansos</span>
                  <span className="text-xs font-black text-emerald-400 mt-0.5 block tabular-nums">{restCount} días</span>
                </div>
                <div className="bg-neutral-950 p-2.5 rounded-xl border border-white/[0.06]">
                  <span className="text-[8px] text-white uppercase font-black tracking-widest block">Flechas Indicadas</span>
                  <span className="text-xs font-black text-yellow-gold mt-0.5 block tabular-nums">{totalArrows > 0 ? totalArrows.toLocaleString() : "—"}</span>
                </div>
              </div>

              {/* Coach Recipient Selector: Send to 1 athlete or all */}
              {(user.role === "coach" || user.role === "team_admin_coach") && clubAthletes.length > 0 && (
                <div className="p-3 sm:p-3.5 rounded-2xl bg-neutral-950 border border-white/10 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-cyan-neon uppercase font-black tracking-widest flex items-center gap-1.5">
                      <Users size={13} className="text-cyan-neon" />
                      <span>Destinatario del Plan</span>
                    </span>
                    <span className="text-[9px] text-white font-bold uppercase tracking-wider bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                      {assignTarget === "all" ? "Todo el Club" : "1 Alumno"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAssignTarget("all")}
                      className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer border ${
                        assignTarget === "all"
                          ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon"
                          : "bg-neutral-900 border-white/10 text-white hover:text-white"
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
                          ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon"
                          : "bg-neutral-900 border-white/10 text-white hover:text-white"
                      }`}
                    >
                      <User size={13} />
                      <span>1 Alumno Específico</span>
                    </button>
                  </div>

                  {assignTarget === "single" && (
                    <div className="flex flex-col gap-1.5 pt-1 animate-fadeIn">
                      <label className="text-[9px] text-white uppercase font-black tracking-widest">
                        Selecciona el alumno:
                      </label>
                      <select
                        value={selectedAthleteId}
                        onChange={(e) => setSelectedAthleteId(e.target.value)}
                        className="bg-neutral-900 border border-white/15 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon font-bold cursor-pointer"
                      >
                        {clubAthletes.map((ath) => (
                          <option key={ath.uid} value={ath.uid}>
                            {ath.fullName || ath.email} · {ath.bowConfig?.type || "Arquero"}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* PREVIEW CONTAINER */}
              {importPreview.mode === "daily" ? (
                viewMode === "table" ? (
                  <div className="rounded-xl border border-white/10 overflow-hidden bg-neutral-950 max-h-60 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead className="bg-neutral-900 sticky top-0 z-10 border-b border-white/10">
                        <tr>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white w-8 text-center">#</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white">Fecha</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white">Texto / Actividad Literal</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white text-right">Flechas</th>
                          <th className="py-2 px-2.5 text-[9px] font-black uppercase tracking-wider text-white">Columnas Adicionales / Notas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono">
                        {importPreview.dailyEntries.map((row, idx) => (
                          <tr 
                            key={`${row.date}-${idx}`}
                            className={`hover:bg-white/[0.03] transition ${row.isRestDay ? "bg-emerald-500/[0.03]" : ""}`}
                          >
                            <td className="py-2 px-2.5 text-[10px] text-white text-center tabular-nums">{idx + 1}</td>
                            <td className="py-2 px-2.5 text-white whitespace-nowrap font-bold tabular-nums">{row.date}</td>
                            <td className="py-2 px-2.5 text-white font-sans font-semibold">
                              {row.title}
                            </td>
                            <td className="py-2 px-2.5 text-right whitespace-nowrap tabular-nums">
                              {row.targetArrows > 0 ? (
                                <span className="text-cyan-neon font-black">{row.targetArrows}</span>
                              ) : (
                                <span className="text-white">—</span>
                              )}
                            </td>
                            <td className="py-2 px-2.5 text-white font-sans text-[10px]">
                              {[
                                row.focusPoints && row.focusPoints.length > 0 ? row.focusPoints.join(", ") : "",
                                row.notes || ""
                              ].filter(Boolean).join(" · ") || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-1">
                    {importPreview.dailyEntries.map((dayItem, i) => (
                      <div
                        key={`${dayItem.date}-${i}`}
                        className="p-2.5 rounded-xl bg-neutral-950 border border-white/[0.06] flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              dayItem.isRestDay ? "bg-emerald-400" : dayItem.type === "competition" ? "bg-rose-400" : "bg-cyan-neon"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-white truncate text-xs">{dayItem.title}</div>
                            <div className="text-[10px] text-white font-mono truncate tabular-nums">
                              {dayItem.date} {dayItem.focusPoints && dayItem.focusPoints.length > 0 ? `· ${dayItem.focusPoints.join(", ")}` : ""}
                            </div>
                            {dayItem.notes && (
                              <div className="text-[10px] text-white italic truncate mt-0.5">
                                {dayItem.notes}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-cyan-neon font-black font-mono whitespace-nowrap text-xs tabular-nums">
                            {dayItem.targetArrows > 0 ? `${dayItem.targetArrows} fl.` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-1">
                  {importPreview.stages.map((stg, i) => (
                    <div
                      key={stg.id || i}
                      className="p-2.5 rounded-xl bg-neutral-950 border border-white/[0.06] flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: stg.color || "#00E5FF" }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-white truncate">{stg.name}</div>
                          <div className="text-[10px] text-white font-mono tabular-nums">
                            {stg.startDate} al {stg.endDate}
                            {stg.weeklySessionGoal > 0 ? ` · ${stg.weeklySessionGoal} sesiones/sem` : ""}
                          </div>
                          {stg.notes && (
                            <div className="text-[10px] text-white italic truncate mt-0.5">
                              {stg.notes}
                            </div>
                          )}
                        </div>
                      </div>
                      {stg.weeklyArrowGoal > 0 && (
                        <div className="text-right shrink-0">
                          <div className="text-cyan-neon font-black font-mono tabular-nums">
                            {stg.weeklyArrowGoal} fl/sem
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-[#0D0F12] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="py-2.5 px-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white hover:text-white font-bold text-xs uppercase cursor-pointer transition border border-white/10"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={!importPreview || (importPreview.stages.length === 0 && importPreview.dailyEntries.length === 0) || isSubmitting}
            onClick={handleConfirmImport}
            className="flex-1 py-3 px-5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer active:scale-98"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Aplicando al Calendario...</span>
              </>
            ) : (
              <>
                <Check size={15} />
                <span>
                  {(user.role === "coach" || user.role === "team_admin_coach") && assignTarget === "single"
                    ? `Aplicar al Calendario de ${clubAthletes.find(a => a.uid === selectedAthleteId)?.fullName || "Alumno"}`
                    : "Aplicar Literalmente al Calendario"}
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
