"use client";

import React, { useState, useRef, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { Macrocycle, MacrocyclePhase, ETAPA_COLORS } from "@/lib/db/macrocycleTypes";
import {
  saveLocalMacrocycle,
  generateResilientId,
  addToSyncQueue,
  getLocalSetting
} from "@/lib/db/indexedDB";
import {
  saveDailyEntriesToCalendar,
  isTrainingDayForWeeklyGoal,
  SyncCycleSummary
} from "@/lib/cycleCalendarSync";
import {
  parseSpreadsheetData,
  parseDelimitedTextToMatrix,
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
  const hasCoachRole =
    user.role === "coach" ||
    user.role === "team_admin_coach" ||
    user.role === "team_admin" ||
    user.role === "superadmin";
  const isCoachUser = Boolean(coachViewMode || hasCoachRole);
  const canonicalClubId =
    user.clubId && user.clubId !== "CLB-DEMO" ? user.clubId : `CLB-${user.uid}`;

  const [refMonth, setRefMonth] = useState<number>(new Date().getMonth() + 1);
  const [refYear, setRefYear] = useState<number>(new Date().getFullYear());
  const [importPlanName, setImportPlanName] = useState<string>("");

  // Tabla de los días del mes en vista previa (1..31) + días importados de otros meses
  const [dayRows, setDayRows] = useState<DayRowState[]>([]);
  const [extraMonthEntries, setExtraMonthEntries] = useState<ParsedDailyEntry[]>([]);
  const [importedStages, setImportedStages] = useState<MacrocyclePhase[]>([]);

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

  const createBlankMonthRows = (year: number, month: number): DayRowState[] => {
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

    return rows;
  };

  const buildRowsWithEntries = (
    year: number,
    month: number,
    entriesForMonth: ParsedDailyEntry[]
  ): DayRowState[] => {
    const next = createBlankMonthRows(year, month);
    const ymPrefix = `${year}-${String(month).padStart(2, "0")}-`;
    for (const entry of entriesForMonth) {
      if (!entry.date.startsWith(ymPrefix)) continue;
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
          const prevArrows = parseInt(next[targetIdx].arrows, 10) || 0;
          next[targetIdx].arrows = String(prevArrows + entry.targetArrows);
        }
      }
    }
    return next;
  };

  const convertDayRowsToEntries = (rows: DayRowState[]): ParsedDailyEntry[] => {
    return rows
      .filter((r) => r.text.trim().length > 0 || Number(r.arrows) > 0)
      .map((r) => {
        const items = r.text
          .split(/\r?\n|\s*;\s*/)
          .map((s) => s.trim())
          .filter(Boolean);
        const arrowGoal = Math.max(0, parseInt(r.arrows, 10) || 0);
        const isRest =
          items.length === 1 &&
          /^(descanso|libre|rest|off|día libre|dia libre)$/i.test(items[0]) &&
          arrowGoal === 0;
        const lowerJoined = items.join(" ").toLowerCase();
        const evType: "training" | "competition" | "meeting" | "other" = isRest
          ? "other"
          : lowerJoined.includes("torneo") || lowerJoined.includes("competencia")
          ? "competition"
          : lowerJoined.includes("reunión") || lowerJoined.includes("reunion")
          ? "meeting"
          : "training";

        return {
          date: r.dateIso,
          title: items[0] || (arrowGoal > 0 ? `${arrowGoal} flechas` : "Entrenamiento"),
          targetArrows: arrowGoal,
          type: evType,
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
  };

  // Construir filas 1..N del mes seleccionado
  const buildMonthRows = async (year: number, month: number) => {
    setDayRows(createBlankMonthRows(year, month));
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
    setExtraMonthEntries([]);
    setImportedStages([]);
    buildMonthRows(y, m);

    async function loadRoster() {
      if (propAthletes && propAthletes.length > 0) {
        setClubAthletes(propAthletes);
      } else if (isCoachUser) {
        const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const filtered = (allUsers || []).filter(
          (u) =>
            (u.clubId === canonicalClubId ||
              (user.clubId && u.clubId === user.clubId)) &&
            u.role === "archer" &&
            u.uid !== user.uid
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
  }, [isOpen, propAthletes, preselectedAthleteIds, isCoachUser, canonicalClubId, user.clubId, user.uid]);

  if (!isOpen) return null;

  const handleMonthYearChange = (newYear: number, newMonth: number) => {
    const currentYmPrefix = `${refYear}-${String(refMonth).padStart(2, "0")}-`;
    const targetYmPrefix = `${newYear}-${String(newMonth).padStart(2, "0")}-`;

    const currentMonthEntries = convertDayRowsToEntries(dayRows);
    const allKnownEntries = [
      ...extraMonthEntries.filter((e) => !e.date.startsWith(currentYmPrefix)),
      ...currentMonthEntries
    ];

    const entriesForTarget = allKnownEntries.filter((e) => e.date.startsWith(targetYmPrefix));
    const entriesForOtherMonths = allKnownEntries.filter((e) => !e.date.startsWith(targetYmPrefix));

    setRefYear(newYear);
    setRefMonth(newMonth);
    if (allKnownEntries.length === 0) {
      setImportPlanName(`Agenda ${MONTH_NAMES[newMonth - 1]} ${newYear}`);
    }
    setDayRows(buildRowsWithEntries(newYear, newMonth, entriesForTarget));
    setExtraMonthEntries(entriesForOtherMonths);
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
    setExtraMonthEntries([]);
    setImportedStages([]);
    setStatusMessage("Se limpiaron todos los días cargados.");
  };

  const applyEntriesAcrossMonths = (
    entries: ParsedDailyEntry[],
    stagesToStore: MacrocyclePhase[] = []
  ) => {
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const firstDateParts = sorted[0].date.split("-");
    const firstYear = parseInt(firstDateParts[0], 10) || refYear;
    const firstMonth = parseInt(firstDateParts[1], 10) || refMonth;
    const firstYmPrefix = `${firstYear}-${String(firstMonth).padStart(2, "0")}-`;

    const activeEntries = sorted.filter((e) => e.date.startsWith(firstYmPrefix));
    const otherEntries = sorted.filter((e) => !e.date.startsWith(firstYmPrefix));

    setRefYear(firstYear);
    setRefMonth(firstMonth);
    setDayRows(buildRowsWithEntries(firstYear, firstMonth, activeEntries));
    setExtraMonthEntries(otherEntries);
    setImportedStages(stagesToStore);

    const defaultPrefix = "Agenda ";
    if (!importPlanName.trim() || importPlanName.startsWith(defaultPrefix)) {
      if (otherEntries.length > 0) {
        const lastDateParts = sorted[sorted.length - 1].date.split("-");
        const lastMonthIdx = (parseInt(lastDateParts[1], 10) || firstMonth) - 1;
        setImportPlanName(
          `Plan ${MONTH_NAMES[firstMonth - 1]} - ${MONTH_NAMES[lastMonthIdx]} ${firstYear}`
        );
      } else {
        setImportPlanName(`Agenda ${MONTH_NAMES[firstMonth - 1]} ${firstYear}`);
      }
    }

    const extraNotice =
      otherEntries.length > 0
        ? ` (+ ${otherEntries.length} días adicionales de otros meses listos para guardar)`
        : "";
    setStatusMessage(
      `¡Listo! Se cargaron ${activeEntries.length} días en ${MONTH_NAMES[firstMonth - 1]} ${firstYear}${extraNotice}.`
    );
    setShowPasteBox(false);
  };

  // Procesar texto pegado de Excel / Google Sheets / CSV y volcarlo en la tabla respetando multi-mes y etapas
  const applyRawSpreadsheetTextToMonthTable = (rawText: string) => {
    setImportError(null);
    setStatusMessage(null);

    if (!rawText || !rawText.trim()) {
      setImportError("El texto pegado está vacío.");
      return;
    }

    // 1. Intentar con el lector inteligente (día por día, cuadrícula de 7 columnas o rangos por etapas)
    const parsed = parseSpreadsheetData(
      rawText,
      importPlanName || `Agenda ${MONTH_NAMES[refMonth - 1]} ${refYear}`,
      {
        referenceYear: refYear,
        referenceMonth: refMonth
      }
    );

    if (parsed.success && parsed.dailyEntries.length > 0) {
      applyEntriesAcrossMonths(parsed.dailyEntries, parsed.stages || []);
      return;
    }

    // 1B. Soporte para CSV/Excel por Etapas (ej. Macrociclo exportado con Fecha Inicio y Fecha Fin)
    if (parsed.success && parsed.mode === "stages" && parsed.stages.length > 0) {
      const expandedMap = new Map<string, ParsedDailyEntry>();
      let guardDays = 0;

      for (const stage of parsed.stages) {
        const startObj = new Date(stage.startDate + "T12:00:00");
        const endObj = new Date(stage.endDate + "T12:00:00");
        if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) continue;

        const cur = new Date(startObj.getTime());
        while (cur.getTime() <= endObj.getTime() && guardDays < 550) {
          guardDays++;
          const dow = cur.getDay();
          const isTraining =
            stage.weeklySessionGoal > 0
              ? isTrainingDayForWeeklyGoal(dow, stage.weeklySessionGoal)
              : true;

          if (isTraining) {
            const y = cur.getFullYear();
            const m = String(cur.getMonth() + 1).padStart(2, "0");
            const d = String(cur.getDate()).padStart(2, "0");
            const dateStr = `${y}-${m}-${d}`;
            const arrowsPerDay =
              stage.weeklyArrowGoal > 0 && stage.weeklySessionGoal > 0
                ? Math.round(stage.weeklyArrowGoal / Math.max(1, stage.weeklySessionGoal))
                : 0;
            const noteItems = stage.notes
              ? stage.notes
                  .split(/\r?\n|\s*;\s*/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [];
            const dailyItems = [stage.name, ...noteItems].filter(Boolean);

            expandedMap.set(dateStr, {
              date: dateStr,
              title: stage.name,
              targetArrows: arrowsPerDay,
              focusPoints: [],
              notes: stage.notes || "",
              dailyItems,
              customFields: dailyItems.map((it, idx) => ({
                label: idx === 0 ? "Etapa" : `Indicación ${idx}`,
                value: it
              })),
              type: "training",
              isRestDay: false,
              stageName: stage.name
            });
          }

          cur.setDate(cur.getDate() + 1);
        }
      }

      const expandedEntries = Array.from(expandedMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      if (expandedEntries.length > 0) {
        applyEntriesAcrossMonths(expandedEntries, parsed.stages);
        return;
      }
    }

    // 2. Fallback directo para listas simples sin fechas explícitas (soporta TSV \t, CSV , y ;)
    const matrixRows = parseDelimitedTextToMatrix(rawText);
    const nonEmptyRows = matrixRows
      .map((row) =>
        row
          .flatMap((c) => (row.length === 1 ? c.split(/\t|,|;/) : [c]))
          .map((c) => c.replace(/\s*\|\|\|\s*/g, "\n").trim())
          .filter(Boolean)
      )
      .filter((row) => row.length > 0);

    if (nonEmptyRows.length === 0) {
      setImportError("No se encontraron renglones con texto.");
      return;
    }

    // Si la primera fila es un encabezado ("Fecha", "Día", "Nombre de la Etapa", etc.), omitirla
    const firstCellLower = (nonEmptyRows[0][0] || "").toLowerCase();
    const dataOnlyRows =
      nonEmptyRows.length > 1 &&
      /^(fecha|d[ií]a|date|day|nombre de la etapa|etapa|actividad|sesi[oó]n|tarea)\b/i.test(
        firstCellLower
      )
        ? nonEmptyRows.slice(1)
        : nonEmptyRows;

    let filled = 0;
    setExtraMonthEntries([]);
    setImportedStages([]);
    setDayRows((prev) =>
      prev.map((row, idx) => {
        if (idx >= dataOnlyRows.length) return row;
        const cells = [...dataOnlyRows[idx]];
        // Si la primera celda es solo el número de día (ej. "1", "2"), la quitamos del texto
        if (cells.length > 1 && /^\d{1,2}$/.test(cells[0])) {
          cells.shift();
        }
        const textVal = cells.join("\n");
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
  const currentYmPrefix = `${refYear}-${String(refMonth).padStart(2, "0")}-`;
  const otherMonthsCount = extraMonthEntries.filter(
    (e) => !e.date.startsWith(currentYmPrefix)
  ).length;
  const totalDaysToSave = filledDays.length + otherMonthsCount;

  // Meses disponibles cuando hay un plan multi-mes cargado
  const availableYearMonths = Array.from(
    new Set([
      ...(filledDays.length > 0 || otherMonthsCount > 0
        ? [`${refYear}-${String(refMonth).padStart(2, "0")}`]
        : []),
      ...extraMonthEntries.map((e) => e.date.slice(0, 7))
    ])
  ).sort();

  const handleConfirmSave = async () => {
    if (totalDaysToSave === 0) {
      setImportError("Escribe o pega actividades en al menos un día antes de guardar.");
      return;
    }

    if (isCoachUser && assignTarget === "selected" && selectedAthleteIds.length === 0) {
      setImportError("Marca al menos un alumno en la lista o selecciona 'Todos los Alumnos'.");
      return;
    }

    setIsSubmitting(true);
    setImportError(null);

    try {
      const macroId = generateResilientId("MAC");
      const nowIso = new Date().toISOString();
      const activeClubId = canonicalClubId;

      const currentMonthEntries = convertDayRowsToEntries(dayRows);
      const dailyEntries: ParsedDailyEntry[] = [
        ...extraMonthEntries.filter((e) => !e.date.startsWith(currentYmPrefix)),
        ...currentMonthEntries
      ].sort((a, b) => a.date.localeCompare(b.date));

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

      // Construir etapas por mes (o conservar las etapas originales si provienen de un CSV por etapas)
      let phasesForMacro: MacrocyclePhase[];
      if (importedStages.length > 0) {
        phasesForMacro = importedStages;
      } else {
        const groupedByMonth = new Map<string, ParsedDailyEntry[]>();
        for (const entry of dailyEntries) {
          const ym = entry.date.slice(0, 7);
          if (!groupedByMonth.has(ym)) groupedByMonth.set(ym, []);
          groupedByMonth.get(ym)!.push(entry);
        }
        phasesForMacro = [];
        let cIdx = 0;
        groupedByMonth.forEach((mEntries, ym) => {
          const [yStr, mStr] = ym.split("-");
          const mIdx = (parseInt(mStr, 10) || 1) - 1;
          const mArrows = mEntries.reduce((s, e) => s + (e.targetArrows || 0), 0);
          phasesForMacro.push({
            id: `etapa-${Date.now()}-${cIdx}`,
            name: `${MONTH_NAMES[mIdx] || mStr} ${yStr}`,
            startDate: mEntries[0].date,
            endDate: mEntries[mEntries.length - 1].date,
            weeklySessionGoal: 5,
            weeklyArrowGoal: Math.round(mArrows / 4) || 0,
            notes: "",
            color: ETAPA_COLORS[cIdx % ETAPA_COLORS.length].color
          });
          cIdx++;
        });
      }

      const newMacro: Macrocycle = {
        id: macroId,
        clubId: activeClubId,
        coachId: user.uid,
        name: importPlanName.trim() || `Agenda ${MONTH_NAMES[refMonth - 1]} ${refYear}`,
        startDate,
        endDate,
        phases: phasesForMacro,
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
        className="w-full max-w-2xl bg-[#111318] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[94dvh]"
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
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-cyan-neon flex items-center gap-1.5">
                  <Users size={14} className="shrink-0" />
                  <span>¿En el calendario de quién se guardará?</span>
                </span>

                <div className="grid grid-cols-3 gap-1.5 bg-neutral-950 p-1.5 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setAssignTarget("selected")}
                    className={`px-1 py-2 rounded-lg text-[11.5px] sm:text-[12.5px] leading-tight text-center font-black uppercase tracking-[-0.02em] sm:tracking-wider transition flex items-center justify-center gap-1 cursor-pointer ${
                      assignTarget === "selected"
                        ? "bg-cyan-neon text-black shadow-sm"
                        : "text-white hover:bg-white/5"
                    }`}
                  >
                    <User size={11} className="hidden sm:inline shrink-0" />
                    <span>Escoger 1 o Varios</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssignTarget("all")}
                    className={`px-1 py-2 rounded-lg text-[11.5px] sm:text-[12.5px] leading-tight text-center font-black uppercase tracking-[-0.02em] sm:tracking-wider transition flex items-center justify-center gap-1 cursor-pointer ${
                      assignTarget === "all"
                        ? "bg-cyan-neon text-black shadow-sm"
                        : "text-white hover:bg-white/5"
                    }`}
                  >
                    <Users size={11} className="hidden sm:inline shrink-0" />
                    <span>Todos los Alumnos</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssignTarget("personal")}
                    className={`px-1 py-2 rounded-lg text-[11.5px] sm:text-[12.5px] leading-tight text-center font-black uppercase tracking-[-0.02em] sm:tracking-wider transition flex items-center justify-center gap-1 cursor-pointer ${
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
                          <span className="text-white">·</span>
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white font-black uppercase tracking-wider shrink-0">
                  Mes:
                </span>
                <select
                  value={refMonth}
                  onChange={(e) =>
                    handleMonthYearChange(refYear, Number(e.target.value))
                  }
                  className="flex-1 sm:flex-initial bg-neutral-950 border border-white/15 rounded-xl px-3 py-1.5 text-white text-xs font-black outline-none focus:border-cyan-neon cursor-pointer"
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

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.ods,.csv,.tsv,.txt"
                onChange={(e) => handleFileChange(e.target.files?.[0])}
                className="hidden"
              />

              {/* Botones rápidos opcionales para traer de Excel / Sheets */}
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="px-2 py-2 sm:py-1.5 rounded-xl bg-cyan-neon/15 hover:bg-cyan-neon/25 border border-cyan-neon/40 text-cyan-neon text-[12px] sm:text-[12.6px] leading-tight font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer text-center"
                >
                  <ClipboardPaste size={13} className="shrink-0" />
                  <span>Pegar de Excel / Sheets</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-2 sm:py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white text-[12px] sm:text-[12.6px] leading-tight font-bold uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer text-center"
                >
                  <UploadCloud size={13} className="text-cyan-neon shrink-0" />
                  <span>Subir .xlsx</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSheetsUrlBox((v) => !v)}
                  className="px-2 py-2 sm:py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white text-[12px] sm:text-[12.6px] leading-tight font-bold uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer text-center"
                >
                  <Link2 size={13} className="text-emerald-400 shrink-0" />
                  <span>Link Sheets</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadFormattedExcelTemplate(refYear, refMonth)}
                  className="px-2 py-2 sm:py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white text-[12px] sm:text-[12.6px] leading-tight font-bold uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer text-center"
                  title="Descargar hoja vacía con los días del mes"
                >
                  <Download size={12} className="shrink-0" />
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
                className="text-white hover:text-white cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {importError && (
            <div className="bg-white border border-white rounded-2xl p-3 flex items-center gap-2 text-black text-xs font-bold">
              <AlertCircle size={15} className="shrink-0 text-black" />
              <span>{importError}</span>
            </div>
          )}

          {/* TABLA DE 2 COLUMNAS: DÍA 1 AL DÍA 31 DEL MES */}
          <div className="bg-[#0A0C10] border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-3.5 py-2.5 bg-white/[0.03] border-b border-white/10 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-black uppercase tracking-wider text-cyan-neon">
                    Agenda Día por Día — {MONTH_NAMES[refMonth - 1]} {refYear} ({filledDays.length} días en este mes)
                  </span>
                  {otherMonthsCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[10.5px] font-black tabular-nums">
                      + {otherMonthsCount} días adicionales de otros meses listos para guardar
                    </span>
                  )}
                </div>
                {totalDaysToSave > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllDays}
                    className="text-[10.5px] bg-white hover:bg-neutral-200 text-black font-black px-2 py-1 rounded-lg flex items-center gap-1 cursor-pointer transition"
                  >
                    <Trash2 size={11} />
                    <span>Limpiar todo</span>
                  </button>
                )}
              </div>

              {availableYearMonths.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/70">
                    Meses importados:
                  </span>
                  {availableYearMonths.map((ym) => {
                    const [yStr, mStr] = ym.split("-");
                    const yNum = parseInt(yStr, 10);
                    const mNum = parseInt(mStr, 10);
                    const isActiveYm = yNum === refYear && mNum === refMonth;
                    const countInYm = isActiveYm
                      ? filledDays.length
                      : extraMonthEntries.filter((e) => e.date.startsWith(`${ym}-`)).length;
                    return (
                      <button
                        key={ym}
                        type="button"
                        onClick={() => handleMonthYearChange(yNum, mNum)}
                        className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase tracking-wider transition cursor-pointer tabular-nums ${
                          isActiveYm
                            ? "bg-cyan-neon text-black"
                            : "bg-white/5 hover:bg-white/10 text-white border border-white/10"
                        }`}
                      >
                        {MONTH_NAMES[mNum - 1]?.slice(0, 3)} {yNum} ({countInYm})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="divide-y divide-white/[0.06] max-h-[42vh] overflow-y-auto">
              {dayRows.map((row) => {
                const isSunday = row.weekdayIndex === 0;
                const hasContent = row.text.trim().length > 0 || Number(row.arrows) > 0;
                return (
                  <div
                    key={row.day}
                    className={`flex flex-col sm:flex-row sm:items-start gap-2 p-3 transition ${
                      hasContent
                        ? "bg-cyan-neon/[0.04]"
                        : isSunday
                        ? "bg-white/[0.015]"
                        : "bg-transparent"
                    }`}
                  >
                    {/* Fila superior en móvil (<640px): Badge Día X a la izquierda + Flechas y Copiar a la derecha; en sm: columnas 1 y 3 */}
                    <div className="flex items-center justify-between gap-2 sm:contents">
                      <div
                        className={`sm:order-1 sm:w-16 shrink-0 rounded-xl px-2.5 py-1.5 sm:px-2 sm:py-2 flex sm:block items-center gap-1.5 text-center border ${
                          hasContent
                            ? "bg-cyan-neon/15 border-cyan-neon/40 text-white"
                            : isSunday
                            ? "bg-white/[0.03] border-white/10 text-amber-300"
                            : "bg-neutral-950 border-white/10 text-white"
                        }`}
                      >
                        <div className="text-[11.5px] font-black uppercase tracking-wider opacity-80">
                          {row.weekdayShort}
                        </div>
                        <div className="text-xs sm:text-sm font-black tabular-nums leading-tight">
                          Día {row.day}
                        </div>
                      </div>

                      {/* Flechas opcionales + Botón repetir / copiar */}
                      <div className="sm:order-3 flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min={0}
                          value={row.arrows}
                          onChange={(e) => updateDayRow(row.day, "arrows", e.target.value)}
                          placeholder="Flechas"
                          title="Meta de flechas (opcional)"
                          className="w-20 sm:w-16 bg-neutral-950/90 border border-white/10 focus:border-cyan-neon rounded-xl px-2 py-1.5 sm:py-2 text-xs text-cyan-neon font-bold text-center tabular-nums outline-none placeholder:text-white/30"
                        />
                        {hasContent && (
                          <button
                            type="button"
                            onClick={() => handleRepeatWeekdayInMonth(row)}
                            title={`Copiar a todos los ${row.weekdayShort} de ${MONTH_NAMES[refMonth - 1]}`}
                            className="p-2 rounded-xl bg-white/5 hover:bg-cyan-neon/20 text-cyan-neon border border-white/10 transition cursor-pointer shrink-0"
                          >
                            <Copy size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Textarea de entrenamiento: 100% full-width debajo en móvil, columna central flexible en sm: */}
                    <div className="w-full sm:flex-1 sm:min-w-0 sm:order-2">
                      <textarea
                        value={row.text}
                        onChange={(e) => updateDayRow(row.day, "text", e.target.value)}
                        rows={row.text.includes("\n") ? Math.min(4, row.text.split("\n").length) : 1}
                        placeholder="Escribe qué toca este día (usa ';' o Enter para enlistar varias tareas)..."
                        className="w-full bg-neutral-950/90 border border-white/10 focus:border-cyan-neon rounded-xl px-3 py-2 text-xs text-white outline-none resize-y leading-relaxed placeholder:text-white/35"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer de confirmación */}
        <div className="px-3.5 py-3.5 sm:p-5 border-t border-white/[0.06] bg-[#0A0C10] flex items-center justify-between gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-3 sm:px-4 sm:py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs transition cursor-pointer shrink-0 whitespace-nowrap"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={totalDaysToSave === 0 || isSubmitting}
            onClick={handleConfirmSave}
            className="flex-1 sm:flex-initial min-w-0 px-3 sm:px-6 py-3 rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-[12.6px] sm:text-[13.8px] leading-tight text-center uppercase tracking-tight sm:tracking-wider sm:whitespace-nowrap transition disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer tabular-nums"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="animate-spin shrink-0" />
                <span>Guardando en Calendario...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={14} className="shrink-0" />
                <span>
                  Guardar {totalDaysToSave} {totalDaysToSave === 1 ? "Día" : "Días"} en el Calendario
                </span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
