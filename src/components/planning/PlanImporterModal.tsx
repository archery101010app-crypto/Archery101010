"use client";

import React, { useState, useRef, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { Macrocycle } from "@/lib/db/macrocycleTypes";
import {
  saveLocalMacrocycle,
  generateResilientId,
  addToSyncQueue,
  getLocalSetting,
  getLocalEvents
} from "@/lib/db/indexedDB";
import {
  saveDailyEntriesToCalendar,
  SyncCycleSummary
} from "@/lib/cycleCalendarSync";
import {
  parseSpreadsheetData,
  parseExcelWorkbookBuffer,
  ParsedDailyEntry,
  downloadFormattedExcelTemplate,
  fetchGoogleSheetCsv
} from "@/lib/cycleImporter";
import {
  Calendar as CalendarIcon,
  UploadCloud,
  ClipboardPaste,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  Link2,
  RefreshCw,
  Users,
  User,
  Check,
  Copy,
  Trash2
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
  coachViewMode?: boolean;
  athletes?: UserProfile[];
  preselectedAthleteIds?: string[];
}

interface DayRowState {
  day: number;
  dateIso: string;
  weekdayShort: string;
  weekdayIndex: number; // 0 = Dom .. 6 = Sab
  text: string; // Actividades del día (separadas por renglón o "/")
  arrows: string; // Opcional
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default function PlanImporterModal({
  isOpen,
  onClose,
  user,
  onSuccess,
  titleOverride,
  coachViewMode = false,
  athletes: propAthletes,
  preselectedAthleteIds
}: PlanImporterModalProps) {
  const isCoachUser = Boolean(
    coachViewMode || user.role === "coach" || user.role === "team_admin_coach"
  );

  const [refMonth, setRefMonth] = useState<number>(new Date().getMonth() + 1);
  const [refYear, setRefYear] = useState<number>(new Date().getFullYear());
  const [importPlanName, setImportPlanName] = useState<string>("");

  // Tabla de los días del mes (1..31)
  const [dayRows, setDayRows] = useState<DayRowState[]>([]);

  // Herramientas opcionales de pegado / archivo / Google Sheets
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteBoxText, setPasteBoxText] = useState("");
  const [showSheetsUrlBox, setShowSheetsUrlBox] = useState(false);
  const [sheetUrlInput, setSheetUrlInput] = useState("");
  const [isFetchingSheet, setIsFetchingSheet] = useState(false);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedExcelSheet, setSelectedExcelSheet] = useState<string>("");
  const workbookExtractorRef = useRef<((sheetName: string) => string) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Destinatario (Coach: "selected" | "all" | "personal")
  const [assignTarget, setAssignTarget] = useState<"all" | "selected" | "personal">("all");
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [clubAthletes, setClubAthletes] = useState<UserProfile[]>([]);

  const toggleAthleteSelection = (uid: string) => {
    setSelectedAthleteIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  // Construir filas 1..N del mes seleccionado y cargar eventos existentes si los hubiera
  const buildMonthRows = async (year: number, month: number) => {
    const daysCount = new Date(year, month, 0).getDate();
    const rows: DayRowState[] = [];

    for (let d = 1; d <= daysCount; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dow = dateObj.getDay();
      const dateIso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      rows.push({
        day: d,
        dateIso,
        weekdayShort: WEEKDAY_SHORT[dow],
        weekdayIndex: dow,
        text: "",
        arrows: ""
      });
    }

    setDayRows(rows);
  };

  useEffect(() => {
    if (!isOpen) return;

    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    setRefMonth(m);
    setRefYear(y);
    setImportPlanName(`Agenda ${MONTH_NAMES[m - 1]} ${y}`);
    setImportError(null);
    setStatusMessage(null);
    setShowPasteBox(false);
    setShowSheetsUrlBox(false);
    setPasteBoxText("");
    setExcelSheets([]);
    buildMonthRows(y, m);

    async function loadRoster() {
      if (propAthletes && propAthletes.length > 0) {
        setClubAthletes(propAthletes);
      } else if (isCoachUser) {
        const activeClubId =
          user.clubId || "CLB-" + (user.uid ? user.uid.replace("USR-", "") : "DIRECTOR");
        const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const filtered = (allUsers || []).filter(
          (u) =>
            (u.clubId === activeClubId ||
              (user.clubId && u.clubId === user.clubId) ||
              !u.clubId) &&
            u.role === "archer"
        );
        setClubAthletes(filtered);
      }

      if (preselectedAthleteIds && preselectedAthleteIds.length > 0) {
        setAssignTarget("selected");
        setSelectedAthleteIds(preselectedAthleteIds);
      } else {
        setAssignTarget(isCoachUser ? "all" : "personal");
        setSelectedAthleteIds([]);
      }
    }
    loadRoster();
  }, [isOpen, propAthletes, preselectedAthleteIds, isCoachUser, user.clubId, user.uid]);

  if (!isOpen) return null;

  const handleMonthYearChange = (newYear: number, newMonth: number) => {
    setRefYear(newYear);
    setRefMonth(newMonth);
    setImportPlanName(`Agenda ${MONTH_NAMES[newMonth - 1]} ${newYear}`);
    buildMonthRows(newYear, newMonth);
  };

  const updateDayRow = (dayNumber: number, field: "text" | "arrows", value: string) => {
    setDayRows((prev) =>
      prev.map((r) => (r.day === dayNumber ? { ...r, [field]: value } : r))
    );
  };

  // Repetir el texto de un día en todos los mismos días de la semana del mes (ej. todos los Lunes)
  const handleRepeatWeekdayInMonth = (sourceRow: DayRowState) => {
    if (!sourceRow.text.trim() && !sourceRow.arrows.trim()) return;
    setDayRows((prev) =>
      prev.map((r) =>
        r.weekdayIndex === sourceRow.weekdayIndex
          ? { ...r, text: sourceRow.text, arrows: sourceRow.arrows }
          : r
      )
    );
    setStatusMessage(
      `Se copió el contenido del Día ${sourceRow.day} a todos los ${sourceRow.weekdayShort} del mes.`
    );
  };

  const handleClearAllDays = () => {
    setDayRows((prev) => prev.map((r) => ({ ...r, text: "", arrows: "" })));
    setStatusMessage("Se limpiaron todos los días de la tabla.");
  };

  // Procesar texto pegado de Excel / Google Sheets y volcarlo en la tabla Día 1..31
  const applyRawSpreadsheetTextToMonthTable = (rawText: string) => {
    setImportError(null);
    setStatusMessage(null);

    if (!rawText || !rawText.trim()) {
      setImportError("El texto pegado está vacío.");
      return;
    }

    // 1. Intentar con el lector de fechas / números de día (1..31) o cuadrícula de 7 columnas
    const parsed = parseSpreadsheetData(rawText, importPlanName || `Agenda ${MONTH_NAMES[refMonth - 1]} ${refYear}`, {
      referenceYear: refYear,
      referenceMonth: refMonth
    });

    if (parsed.success && parsed.dailyEntries.length > 0) {
      const targetYearMonth = `${refYear}-${String(refMonth).padStart(2, "0")}-`;
      let matchedCount = 0;

      setDayRows((prev) => {
        const next = prev.map((r) => ({ ...r }));
        for (const entry of parsed.dailyEntries) {
          // Si coincide con el mes o extraemos el día (1..31)
          const dayNum = parseInt(entry.date.split("-")[2], 10);
          if (dayNum >= 1 && dayNum <= next.length) {
            const targetIdx = dayNum - 1;
            const cleanItems =
              entry.dailyItems && entry.dailyItems.length > 0
                ? entry.dailyItems
                : [entry.title].filter(Boolean);
            const joined = cleanItems.join("\n");
            next[targetIdx].text = next[targetIdx].text
              ? `${next[targetIdx].text}\n${joined}`
              : joined;
            if (entry.targetArrows > 0) {
              next[targetIdx].arrows = String(entry.targetArrows);
            }
            matchedCount++;
          }
        }
        return next;
      });

      if (matchedCount > 0) {
        setStatusMessage(
          `¡Listo! Se cargaron ${matchedCount} días en la tabla inferior. Revisa o edita cualquier día antes de guardar.`
        );
        setShowPasteBox(false);
        return;
      }
    }

    // 2. Fallback directo y ultra simple: Cada renglón pegado corresponde a Día 1, Día 2, Día 3...
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      setImportError("No se encontraron renglones con texto.");
      return;
    }

    let filled = 0;
    setDayRows((prev) =>
      prev.map((row, idx) => {
        if (idx >= lines.length) return row;
        const cells = lines[idx]
          .split(/\t/)
          .map((c) => c.trim())
          .filter(Boolean);
        // Si la primera celda es solo el número de día (ej. "1", "2"), la quitamos del texto
        if (cells.length > 1 && /^\d{1,2}$/.test(cells[0])) {
          cells.shift();
        }
        const textVal = cells.join(" / ");
        if (textVal) filled++;
        return {
          ...row,
          text: textVal
        };
      })
    );

    setStatusMessage(
      `Se volcaron ${filled} renglones directamente en los días del mes. Puedes revisar o ajustar cada día abajo.`
    );
    setShowPasteBox(false);
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim()) {
          applyRawSpreadsheetTextToMonthTable(clip);
          return;
        }
      }
      setShowPasteBox(true);
    } catch {
      setShowPasteBox(true);
    }
  };

  const handleFileChange = (file?: File | null) => {
    if (!file) return;
    setImportError(null);
    setStatusMessage(null);

    const isExcelBinary = /\.(xlsx|xls|ods)$/i.test(file.name);
    if (isExcelBinary) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        if (buffer) {
          const { sheetNames, getSheetTsv } = parseExcelWorkbookBuffer(buffer);
          workbookExtractorRef.current = getSheetTsv;
          setExcelSheets(sheetNames);
          if (sheetNames.length > 0) {
            const firstSheet = sheetNames[0];
            setSelectedExcelSheet(firstSheet);
            const tsv = getSheetTsv(firstSheet);
            applyRawSpreadsheetTextToMonthTable(tsv);
          } else {
            setImportError("El archivo Excel parece no tener hojas legibles.");
          }
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        if (content) {
          applyRawSpreadsheetTextToMonthTable(content);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFetchGoogleSheet = async () => {
    if (!sheetUrlInput.trim()) return;
    setIsFetchingSheet(true);
    setImportError(null);
    try {
      const res = await fetchGoogleSheetCsv(sheetUrlInput);
      if (res.ok && res.csv) {
        applyRawSpreadsheetTextToMonthTable(res.csv);
        setShowSheetsUrlBox(false);
      } else {
        setImportError(res.error || "No se pudo leer el enlace de Google Sheets.");
      }
    } catch {
      setImportError("Error de red al conectar con Google Sheets.");
    } finally {
      setIsFetchingSheet(false);
    }
  };

  const filledDays = dayRows.filter((r) => r.text.trim().length > 0 || Number(r.arrows) > 0);

  const handleConfirmSave = async () => {
    if (filledDays.length === 0) {
      setImportError("Escribe o pega actividades en al menos un día del mes antes de guardar.");
      return;
    }

    if (isCoachUser && assignTarget === "selected" && selectedAthleteIds.length === 0) {
      setImportError("Marca al menos un alumno en la lista o selecciona 'Todos mis Alumnos'.");
      return;
    }

    setIsSubmitting(true);
    setImportError(null);

    try {
      const macroId = generateResilientId("MAC");
      const nowIso = new Date().toISOString();
      const activeClubId =
        user.clubId || "CLB-" + (user.uid ? user.uid.replace("USR-", "") : "DIRECTOR");

      const dailyEntries: ParsedDailyEntry[] = filledDays.map((r) => {
        const items = r.text
          .split(/\r?\n|\s*\/\s*|\s*;\s*/)
          .map((s) => s.trim())
          .filter(Boolean);
        const arrowGoal = Math.max(0, parseInt(r.arrows, 10) || 0);
        const isRest =
          items.length === 1 &&
          /^(descanso|libre|rest|off|día libre|dia libre)$/i.test(items[0]) &&
          arrowGoal === 0;

        return {
          date: r.dateIso,
          title: items[0] || (arrowGoal > 0 ? `${arrowGoal} flechas` : "Entrenamiento"),
          targetArrows: arrowGoal,
          type: "training",
          isRestDay: isRest,
          notes: items.length > 1 ? items.slice(1).join(" · ") : "",
          focusPoints: [],
          dailyItems: items,
          customFields: items.map((it, idx) => ({
            label: `Tarea ${idx + 1}`,
            value: it
          }))
        };
      });

      const totalArrows = dailyEntries.reduce((acc, d) => acc + (d.targetArrows || 0), 0);
      const startDate = dailyEntries[0].date;
      const endDate = dailyEntries[dailyEntries.length - 1].date;

      const isForSpecificAthletes =
        isCoachUser && assignTarget === "selected" && selectedAthleteIds.length > 0;
      const isPersonalOnly = !isCoachUser || assignTarget === "personal";

      const targetIdsForSave = isPersonalOnly
        ? [user.uid]
        : isForSpecificAthletes
        ? selectedAthleteIds
        : undefined;

      const newMacro: Macrocycle = {
        id: macroId,
        clubId: activeClubId,
        coachId: user.uid,
        name: importPlanName.trim() || `Agenda ${MONTH_NAMES[refMonth - 1]} ${refYear}`,
        startDate,
        endDate,
        phases: [
          {
            id: `etapa-${Date.now()}-0`,
            name: `${MONTH_NAMES[refMonth - 1]} ${refYear}`,
            startDate,
            endDate,
            weeklySessionGoal: 5,
            weeklyArrowGoal: Math.round(totalArrows / 4) || 0,
            notes: "",
            color: "#00E5FF"
          }
        ],
        assignmentType: isPersonalOnly
          ? "individual"
          : isForSpecificAthletes
          ? selectedAthleteIds.length === 1
            ? "individual"
            : "group"
          : "club",
        assignedAthleteIds: targetIdsForSave || [],
        groupName:
          isForSpecificAthletes && selectedAthleteIds.length > 1
            ? `${selectedAthleteIds.length} alumnos seleccionados`
            : undefined,
        volumeGoal: totalArrows,
        currentVolume: 0,
        status: "active",
        createdAt: nowIso,
        updatedAt: nowIso
      };

      await saveLocalMacrocycle(newMacro.id, newMacro);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "macrocycles",
        operation: "INSERT",
        payloadId: newMacro.id,
        payload: newMacro,
        timestamp: Date.now()
      });

      const syncSummary = await saveDailyEntriesToCalendar(
        dailyEntries,
        newMacro,
        user
      );

      onSuccess({
        macrocycle: newMacro,
        summary: syncSummary
      });
      onClose();
    } catch (err) {
      console.error("Error guardando la agenda mensual:", err);
      setImportError("Ocurrió un problema al guardar la agenda en el calendario.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl bg-[#111318] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[94vh]"
      >
        {/* Encabezado Estilo Google Calendar */}
        <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-center justify-between bg-[#0A0C10]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/30 flex items-center justify-center text-cyan-neon shrink-0">
              <CalendarIcon size={20} />
            </div>
            <div>
              <h3 className="text-white font-black text-base tracking-tight">
                {titleOverride || "Planificador Mensual (Día 1 al 31)"}
              </h3>
              <p className="text-[11.5px] text-white mt-0.5">
                Escribe directo en cada día o pega tus renglones desde Excel / Google Sheets
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cuerpo Principal */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Paso 1 (Solo para Coach): ¿A quién se le carga en su Calendario? */}
          {isCoachUser && (
            <div className="bg-[#0D1017] border border-cyan-neon/25 rounded-2xl p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] font-black uppercase tracking-wider text-cyan-neon flex items-center gap-1.5">
                  <Users size={14} />
                  <span>¿En el calendario de quién se guardará?</span>
                </span>

                <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-white/10 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setAssignTarget("selected")}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase tracking-wider transition flex items-center gap-1 cursor-pointer ${
                      assignTarget === "selected"
                        ? "bg-cyan-neon text-black shadow-sm"
                        : "text-white hover:bg-white/5"
                    }`}
                  >
                    <User size={11} />
                    <span>Escoger 1 o Varios</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssignTarget("all")}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase tracking-wider transition flex items-center gap-1 cursor-pointer ${
                      assignTarget === "all"
                        ? "bg-cyan-neon text-black shadow-sm"
                        : "text-white hover:bg-white/5"
                    }`}
                  >
                    <Users size={11} />
                    <span>Todos los Alumnos</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssignTarget("personal")}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase tracking-wider transition flex items-center gap-1 cursor-pointer ${
                      assignTarget === "personal"
                        ? "bg-cyan-neon text-black shadow-sm"
                        : "text-white hover:bg-white/5"
                    }`}
                  >
                    <span>Solo Mi Calendario</span>
                  </button>
                </div>
              </div>

              {assignTarget === "selected" && (
                <div className="flex flex-col gap-2 pt-1">
                  {clubAthletes.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between text-[11px] text-white">
                        <span>
                          Toca para marcar a <strong>1 o varios alumnos</strong> (
                          {selectedAthleteIds.length} seleccionados):
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedAthleteIds(clubAthletes.map((a) => a.uid))
                            }
                            className="text-[10.5px] text-cyan-neon font-bold hover:underline cursor-pointer"
                          >
                            Marcar todos
                          </button>
                          <span className="text-white/30">·</span>
                          <button
                            type="button"
                            onClick={() => setSelectedAthleteIds([])}
                            className="text-[10.5px] text-white font-bold hover:underline cursor-pointer"
                          >
                            Limpiar
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-32 overflow-y-auto pr-1">
                        {clubAthletes.map((ath) => {
                          const isChecked = selectedAthleteIds.includes(ath.uid);
                          return (
                            <button
                              key={ath.uid}
                              type="button"
                              onClick={() => toggleAthleteSelection(ath.uid)}
                              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                                isChecked
                                  ? "bg-cyan-neon/15 border-cyan-neon text-white"
                                  : "bg-neutral-950/80 border-white/10 text-white hover:border-white/25"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className={`w-4 h-4 rounded-md flex items-center justify-center border shrink-0 ${
                                    isChecked
                                      ? "bg-cyan-neon border-cyan-neon text-black"
                                      : "border-white/30 bg-transparent"
                                  }`}
                                >
                                  {isChecked && <Check size={11} strokeWidth={3} />}
                                </div>
                                <span className="text-xs font-bold truncate">
                                  {ath.fullName}
                                </span>
                              </div>
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/5 text-cyan-neon shrink-0">
                                {ath.bowConfig?.type || "Arquero"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-amber-400">
                      Aún no tienes alumnos registrados en tu club. Se guardará para todo el club.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Paso 2: Selector de Mes/Año + Botones Rápidos para Pegar de Excel/Sheets */}
          <div className="bg-[#0D1017] border border-white/10 rounded-2xl p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white font-black uppercase tracking-wider">
                  Mes:
                </span>
                <select
                  value={refMonth}
                  onChange={(e) =>
                    handleMonthYearChange(refYear, Number(e.target.value))
                  }
                  className="bg-neutral-950 border border-white/15 rounded-xl px-3 py-1.5 text-white text-xs font-black outline-none focus:border-cyan-neon cursor-pointer"
                >
                  {MONTH_NAMES.map((mName, idx) => (
                    <option key={mName} value={idx + 1}>
                      {mName}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={2025}
                  max={2035}
                  value={refYear}
                  onChange={(e) =>
                    handleMonthYearChange(
                      Number(e.target.value) || new Date().getFullYear(),
                      refMonth
                    )
                  }
                  className="w-20 bg-neutral-950 border border-white/15 rounded-xl px-2 py-1.5 text-white text-xs font-black outline-none focus:border-cyan-neon text-center tabular-nums"
                />
              </div>

              {/* Botones rápidos opcionales para traer de Excel / Sheets */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="px-2.5 py-1.5 rounded-xl bg-cyan-neon/15 hover:bg-cyan-neon/25 border border-cyan-neon/40 text-cyan-neon text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer"
                >
                  <ClipboardPaste size={13} />
                  <span>Pegar de Excel / Sheets</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer"
                >
                  <UploadCloud size={13} className="text-cyan-neon" />
                  <span>Subir .xlsx</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.ods,.csv,.tsv,.txt"
                  onChange={(e) => handleFileChange(e.target.files?.[0])}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => setShowSheetsUrlBox((v) => !v)}
                  className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 transition cursor-pointer"
                >
                  <Link2 size={13} className="text-emerald-400" />
                  <span>Link Sheets</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadFormattedExcelTemplate(refYear, refMonth)}
                  className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 transition cursor-pointer"
                  title="Descargar hoja vacía con los días del mes"
                >
                  <Download size={12} />
                  <span>Plantilla Vacía</span>
                </button>
              </div>
            </div>

            {/* Si el archivo Excel subido tiene varias pestañas */}
            {excelSheets.length > 1 && (
              <div className="flex items-center gap-2 pt-2 border-t border-white/10 flex-wrap">
                <span className="text-[10.5px] font-black uppercase text-cyan-neon">
                  Pestaña del Excel:
                </span>
                {excelSheets.map((sName) => (
                  <button
                    key={sName}
                    type="button"
                    onClick={() => {
                      setSelectedExcelSheet(sName);
                      if (workbookExtractorRef.current) {
                        applyRawSpreadsheetTextToMonthTable(
                          workbookExtractorRef.current(sName)
                        );
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      selectedExcelSheet === sName
                        ? "bg-cyan-neon text-black font-black"
                        : "bg-white/5 text-white hover:bg-white/10"
                    }`}
                  >
                    {sName}
                  </button>
                ))}
              </div>
            )}

            {/* Cuadro manual para pegar texto si el navegador pide pegar manualmente */}
            {showPasteBox && (
              <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
                <span className="text-[11px] text-white font-bold">
                  Pega aquí las celdas copiadas de tu Excel o Google Sheets (pueden tener fecha o ser simplemente los renglones del mes):
                </span>
                <textarea
                  value={pasteBoxText}
                  onChange={(e) => setPasteBoxText(e.target.value)}
                  rows={4}
                  placeholder="Mantén presionado aquí y selecciona 'Pegar'..."
                  className="bg-neutral-950 border border-cyan-neon/40 rounded-xl p-3 text-xs text-white outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPasteBox(false)}
                    className="px-3 py-1.5 rounded-xl bg-white/5 text-white text-xs font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRawSpreadsheetTextToMonthTable(pasteBoxText)}
                    className="px-3.5 py-1.5 rounded-xl bg-cyan-neon text-black text-xs font-black uppercase cursor-pointer"
                  >
                    Pasar a la Tabla del Mes
                  </button>
                </div>
              </div>
            )}

            {/* Cuadro opcional para pegar link de Google Sheets */}
            {showSheetsUrlBox && (
              <div className="flex gap-2 pt-2 border-t border-white/10">
                <input
                  type="url"
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 bg-neutral-950 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-neon"
                />
                <button
                  type="button"
                  onClick={handleFetchGoogleSheet}
                  disabled={isFetchingSheet || !sheetUrlInput.trim()}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-500 text-black font-black text-xs uppercase cursor-pointer disabled:opacity-40 flex items-center gap-1"
                >
                  {isFetchingSheet ? <RefreshCw size={13} className="animate-spin" /> : null}
                  <span>Cargar</span>
                </button>
              </div>
            )}
          </div>

          {statusMessage && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-3 text-xs text-emerald-300 font-bold flex items-center justify-between gap-2">
              <span>{statusMessage}</span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="text-white/60 hover:text-white cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {importError && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3 flex items-center gap-2 text-rose-300 text-xs font-bold">
              <AlertCircle size={15} className="shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {/* TABLA DE 2 COLUMNAS: DÍA 1 AL DÍA 31 DEL MES */}
          <div className="bg-[#0A0C10] border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-3.5 py-2.5 bg-white/[0.03] border-b border-white/10 flex items-center justify-between gap-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-cyan-neon">
                Agenda Día por Día — {MONTH_NAMES[refMonth - 1]} {refYear} ({filledDays.length} días con plan)
              </span>
              {filledDays.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllDays}
                  className="text-[10.5px] text-rose-400 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 size={11} />
                  <span>Limpiar todo</span>
                </button>
              )}
            </div>

            <div className="divide-y divide-white/[0.06] max-h-[42vh] overflow-y-auto">
              {dayRows.map((row) => {
                const isSunday = row.weekdayIndex === 0;
                const hasContent = row.text.trim().length > 0 || Number(row.arrows) > 0;
                return (
                  <div
                    key={row.day}
                    className={`flex items-start gap-2.5 p-2.5 transition ${
                      hasContent
                        ? "bg-cyan-neon/[0.04]"
                        : isSunday
                        ? "bg-white/[0.015]"
                        : "bg-transparent"
                    }`}
                  >
                    {/* Columna 1: Fecha / Número de Día */}
                    <div
                      className={`w-16 shrink-0 rounded-xl px-2 py-2 text-center border ${
                        hasContent
                          ? "bg-cyan-neon/15 border-cyan-neon/40 text-white"
                          : isSunday
                          ? "bg-white/[0.03] border-white/10 text-amber-300"
                          : "bg-neutral-950 border-white/10 text-white"
                      }`}
                    >
                      <div className="text-[10px] font-black uppercase tracking-wider opacity-80">
                        {row.weekdayShort}
                      </div>
                      <div className="text-sm font-black tabular-nums leading-tight">
                        Día {row.day}
                      </div>
                    </div>

                    {/* Columna 2: Lo que corresponde ese día */}
                    <div className="flex-1 min-w-0">
                      <textarea
                        value={row.text}
                        onChange={(e) => updateDayRow(row.day, "text", e.target.value)}
                        rows={row.text.includes("\n") ? Math.min(4, row.text.split("\n").length) : 1}
                        placeholder="Escribe qué toca este día (usa '/' o Enter para enlistar varias tareas)..."
                        className="w-full bg-neutral-950/90 border border-white/10 focus:border-cyan-neon rounded-xl px-3 py-2 text-xs text-white outline-none resize-y leading-relaxed placeholder:text-white/35"
                      />
                    </div>

                    {/* Flechas opcionales + Botón repetir en todos los mismos días de la semana */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min={0}
                        value={row.arrows}
                        onChange={(e) => updateDayRow(row.day, "arrows", e.target.value)}
                        placeholder="Flechas"
                        title="Meta de flechas (opcional)"
                        className="w-16 bg-neutral-950/90 border border-white/10 focus:border-cyan-neon rounded-xl px-2 py-2 text-xs text-cyan-neon font-bold text-center tabular-nums outline-none placeholder:text-white/30"
                      />
                      {hasContent && (
                        <button
                          type="button"
                          onClick={() => handleRepeatWeekdayInMonth(row)}
                          title={`Copiar a todos los ${row.weekdayShort} de ${MONTH_NAMES[refMonth - 1]}`}
                          className="p-2 rounded-xl bg-white/5 hover:bg-cyan-neon/20 text-cyan-neon border border-white/10 transition cursor-pointer"
                        >
                          <Copy size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer de confirmación */}
        <div className="p-4 sm:p-5 border-t border-white/[0.06] bg-[#0A0C10] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs transition cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={filledDays.length === 0 || isSubmitting}
            onClick={handleConfirmSave}
            className="flex-1 sm:flex-initial px-6 py-3 rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider transition disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(0,229,255,0.25)] cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Guardando en Calendario...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={15} />
                <span>
                  Guardar {filledDays.length} {filledDays.length === 1 ? "Día" : "Días"} en el Calendario
                </span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
