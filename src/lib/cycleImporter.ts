import { Macrocycle, MacrocyclePhase, ETAPA_COLORS } from "@/lib/db/macrocycleTypes";

export interface ParsedDailyEntry {
  date: string; // YYYY-MM-DD
  title: string;
  targetArrows: number;
  focusPoints: string[];
  notes: string;
  type: "training" | "competition" | "meeting" | "other";
  isRestDay: boolean;
  stageName?: string;
}

export interface ParsedCycleResult {
  success: boolean;
  mode: "daily" | "stages";
  planName: string;
  startDate: string;
  endDate: string;
  totalVolumeGoal: number;
  stages: MacrocyclePhase[];
  dailyEntries: ParsedDailyEntry[];
  warnings: string[];
  error?: string;
}

const SPANISH_MONTHS: Record<string, string> = {
  ene: "01", enero: "01", jan: "01",
  feb: "02", febrero: "02",
  mar: "03", marzo: "03",
  abr: "04", abril: "04", apr: "04",
  may: "05", mayo: "05",
  jun: "06", junio: "06",
  jul: "07", julio: "07",
  ago: "08", agosto: "08", aug: "08",
  sep: "09", sept: "09", septiembre: "09", set: "09",
  oct: "10", octubre: "10",
  nov: "11", noviembre: "11",
  dic: "12", diciembre: "12", dec: "12"
};

/**
 * Checks if a raw cell string looks like a valid calendar date
 */
export function isValidDateCell(raw?: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return false;

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/.test(trimmed)) return true;
  // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY
  if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(trimmed)) return true;
  // DD de mes de YYYY or DD mes YYYY (e.g., "15 oct 2026", "15-oct-26", "Lunes 15/10/2026")
  if (/\d{1,2}[\/\-\.\s]+([a-záéíóú]{3,10})[\/\-\.\s]*(\d{2,4})?/.test(trimmed)) {
    const match = trimmed.match(/\d{1,2}[\/\-\.\s]+([a-záéíóú]{3,10})/);
    if (match && SPANISH_MONTHS[match[1]]) return true;
  }
  // Day name prefix + numeric date (e.g. "Lun 26/10/2026")
  if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(trimmed)) return true;

  return false;
}

/**
 * Normalizes dates from formats like DD/MM/YYYY, DD/MM/YY, "15 oct 2026", "Lun 15/10/2026", or YYYY-MM-DD into standard YYYY-MM-DD
 */
export function normalizeDateString(raw: string, fallbackDate: string): string {
  if (!raw) return fallbackDate;
  const trimmed = raw.trim().toLowerCase();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Extract embedded YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = trimmed.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY (even with day prefix like "Lun 26/10/2026")
  const dmyMatch = trimmed.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmyMatch) {
    let [, d, m, y] = dmyMatch;
    if (y.length === 2) {
      y = `20${y}`;
    }
    // Handle case where someone wrote MM/DD/YYYY (if m > 12 and d <= 12)
    const mNum = parseInt(m, 10);
    const dNum = parseInt(d, 10);
    if (mNum > 12 && dNum <= 12) {
      return `${y}-${d.padStart(2, "0")}-${m.padStart(2, "0")}`;
    }
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD mes YYYY or DD-mes-YY (e.g. "26 oct 2026", "26 de octubre 2026", "26-oct")
  const textMonthMatch = trimmed.match(/(\d{1,2})(?:\s*de\s*|[\/\-\.\s]+)([a-záéíóú]{3,10})(?:\s*de\s*|[\/\-\.\s]+)?(\d{2,4})?/);
  if (textMonthMatch) {
    const [, d, monthWord, rawYear] = textMonthMatch;
    const monthCode = SPANISH_MONTHS[monthWord] || SPANISH_MONTHS[monthWord.slice(0, 3)];
    if (monthCode) {
      const currentYear = String(new Date().getFullYear());
      let y = rawYear || currentYear;
      if (y.length === 2) y = `20${y}`;
      return `${y}-${monthCode}-${d.padStart(2, "0")}`;
    }
  }

  return fallbackDate;
}

/**
 * Extracts a Google Sheets ID from a shared URL and fetches its CSV content directly.
 */
export async function fetchGoogleSheetCsv(sheetUrl: string): Promise<{ ok: boolean; csv?: string; error?: string }> {
  try {
    const trimmed = sheetUrl.trim();
    const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) {
      return {
        ok: false,
        error: "El enlace no parece ser un documento válido de Google Sheets."
      };
    }
    const sheetId = idMatch[1];
    const gidMatch = trimmed.match(/[#&?]gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";

    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
    const response = await fetch(exportUrl);
    if (!response.ok) {
      return {
        ok: false,
        error: "No se pudo leer la hoja. Asegúrate de que el permiso en Google Sheets sea 'Cualquier persona con el enlace puede ver' o copia y pega las celdas directamente."
      };
    }
    const csvText = await response.text();
    const csvLower = (csvText || "").toLowerCase();
    if (!csvText || csvText.trim().startsWith("<!DOCTYPE html>") || csvLower.includes("offline mode active") || csvLower.includes("connect to the internet")) {
      return {
        ok: false,
        error: "No se pudo leer la hoja. Asegúrate de tener conexión a internet y de que el permiso en Google Sheets sea 'Cualquier persona con el enlace puede ver'."
      };
    }
    return { ok: true, csv: csvText };
  } catch {
    return {
      ok: false,
      error: "No se pudo conectar con Google Sheets. Puedes copiar las celdas de tu hoja y pegarlas directamente en el recuadro de abajo."
    };
  }
}

/**
 * Parses raw text copied and pasted from Excel, Google Sheets, or CSV file.
 * Automatically detects:
 * 1) "daily" mode (Day-by-Day schedule: each row has a single date, activity, arrows, focus/notes)
 * 2) "stages" mode (Macrocycle stages/ranges: each row has Stage, Start Date, End Date, Weekly Sessions, Weekly Arrows, Notes)
 */
export function parseSpreadsheetData(rawText: string, defaultCycleName = "Nuevo Plan Importado"): ParsedCycleResult {
  const warnings: string[] = [];
  const todayStr = new Date().toISOString().split("T")[0];

  const cleanRawLower = (rawText || "").toLowerCase();
  if (!rawText || !rawText.trim() || cleanRawLower.includes("offline mode active") || cleanRawLower.includes("connect to the internet")) {
    return {
      success: false,
      mode: "stages",
      planName: defaultCycleName,
      startDate: todayStr,
      endDate: todayStr,
      totalVolumeGoal: 0,
      stages: [],
      dailyEntries: [],
      warnings: [],
      error: cleanRawLower.includes("offline mode active") || cleanRawLower.includes("connect to the internet")
        ? "No se pudo acceder a la hoja de Google Sheets porque no hay conexión a internet activa."
        : "No se encontró texto o celdas para importar. Copia las celdas de Excel o Google Sheets."
    };
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      success: false,
      mode: "stages",
      planName: defaultCycleName,
      startDate: todayStr,
      endDate: todayStr,
      totalVolumeGoal: 0,
      stages: [],
      dailyEntries: [],
      warnings: [],
      error: "El texto ingresado está vacío."
    };
  }

  // Detect delimiter: check first two lines
  const sampleLine = lines[0];
  let delimiter = "\t";
  if (sampleLine.includes("\t")) {
    delimiter = "\t";
  } else if (sampleLine.includes(";")) {
    delimiter = ";";
  } else if (sampleLine.includes(",")) {
    delimiter = ",";
  }

  // Split lines into cell rows
  const rows = lines.map((line) => {
    if (delimiter === "," || delimiter === ";") {
      const regex = new RegExp(`(?:^|${delimiter})(?:"([^"]*)"|([^${delimiter}]*))`, "g");
      const cells: string[] = [];
      let match;
      while ((match = regex.exec(line)) !== null) {
        cells.push((match[1] || match[2] || "").trim());
      }
      return cells;
    }
    return line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
  });

  // Inspect header row vs data rows
  const firstRowLower = rows[0].map((c) => c.toLowerCase());
  const isHeader = firstRowLower.some(
    (c) =>
      c.includes("fecha") ||
      c.includes("día") ||
      c.includes("dia") ||
      c.includes("date") ||
      c.includes("etapa") ||
      c.includes("fase") ||
      c.includes("nombre") ||
      c.includes("actividad") ||
      c.includes("tarea") ||
      c.includes("inicio") ||
      c.includes("flecha") ||
      c.includes("sesion") ||
      c.includes("nota")
  );

  const dataRows = isHeader ? rows.slice(1) : rows;
  if (dataRows.length === 0) {
    return {
      success: false,
      mode: "stages",
      planName: defaultCycleName,
      startDate: todayStr,
      endDate: todayStr,
      totalVolumeGoal: 0,
      stages: [],
      dailyEntries: [],
      warnings: [],
      error: "Solo se detectó la fila de encabezados. Agrega al menos una fila con datos."
    };
  }

  // Determine whether this sheet is DAY-BY-DAY ("daily") or STAGE RANGES ("stages")
  // Rule:
  // - If header has both "inicio"/"desde" and "fin"/"hasta", it's "stages".
  // - If data rows have TWO valid date columns in the first 3 columns, it's "stages".
  // - If data rows have ONE valid date column (typically column 0 or column 1), it's "daily"!
  const hasStartAndEndHeaders =
    isHeader &&
    firstRowLower.some((h) => h.includes("inicio") || h.includes("desde") || h.includes("start")) &&
    firstRowLower.some((h) => h.includes("fin") || h.includes("hasta") || h.includes("end"));

  const sampleDataRow = dataRows.find((r) => r.some((cell) => cell.length > 0)) || dataRows[0];
  const dateColIndicesInSample = sampleDataRow
    .map((cell, idx) => (isValidDateCell(cell) ? idx : -1))
    .filter((idx) => idx !== -1);

  const isDailyMode = !hasStartAndEndHeaders && dateColIndicesInSample.length === 1;

  // ============================================================================
  // MODE 1: DAY-BY-DAY ("daily") IMPORT
  // ============================================================================
  if (isDailyMode) {
    let dateCol = dateColIndicesInSample[0] ?? 0;
    let titleCol = dateCol === 0 ? 1 : 0;
    let arrowsCol = 2;
    let focusCol = 3;
    let notesCol = 4;

    if (isHeader) {
      firstRowLower.forEach((h, idx) => {
        if (h.includes("fecha") || h.includes("date") || h.includes("día") || h.includes("dia")) dateCol = idx;
        else if (h.includes("actividad") || h.includes("tarea") || h.includes("sesion") || h.includes("sesión") || h.includes("titulo") || h.includes("título") || h.includes("entrenamiento") || h.includes("etapa") || h.includes("nombre")) titleCol = idx;
        else if (h.includes("flecha") || h.includes("volumen") || h.includes("tiros") || h.includes("meta") || h.includes("cantidad")) arrowsCol = idx;
        else if (h.includes("enfoque") || h.includes("tecnica") || h.includes("técnica") || h.includes("foco") || h.includes("objetivo")) focusCol = idx;
        else if (h.includes("nota") || h.includes("indicacion") || h.includes("observacion") || h.includes("detalle") || h.includes("comentario")) notesCol = idx;
      });
    }

    const dailyEntries: ParsedDailyEntry[] = [];
    let rollingDate = todayStr;

    dataRows.forEach((row, idx) => {
      if (row.length === 0 || row.every((c) => !c)) return;

      const rawDate = row[dateCol] || "";
      const date = normalizeDateString(rawDate, rollingDate);
      // Advance rolling fallback by 1 day
      rollingDate = new Date(new Date(date + "T12:00:00").getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const rawTitle = (row[titleCol] || "").trim();
      const rawArrowsStr = row[arrowsCol] !== undefined ? row[arrowsCol] : "";
      const parsedArrows = parseInt(String(rawArrowsStr).replace(/[^0-9]/g, ""), 10);

      // Detect if rest day
      const lowerTitle = rawTitle.toLowerCase();
      const isRestWord = lowerTitle.includes("descanso") || lowerTitle.includes("recuperación") || lowerTitle.includes("recuperacion") || lowerTitle.includes("libre") || lowerTitle === "rest";
      const targetArrows = !isNaN(parsedArrows) ? parsedArrows : (isRestWord ? 0 : 120);
      const isRestDay = targetArrows === 0 || isRestWord;

      const finalTitle = rawTitle || (isRestDay ? "Descanso" : (targetArrows > 0 ? `Entrenamiento (${targetArrows} flechas)` : "Entrenamiento"));

      // Focus points: Solo los que vengan explícitamente en el documento original. NUNCA inventar.
      const rawFocus = row[focusCol] || "";
      const focusPoints = rawFocus
        ? rawFocus.split(/[,;•|]/).map((s) => s.trim()).filter(Boolean)
        : [];

      // Notes: Solo lo que venga en el documento original. NUNCA inventar.
      const rawNotes = row[notesCol] || "";
      const notes = rawNotes.trim();

      // Detect event type
      let type: "training" | "competition" | "meeting" | "other" = "training";
      if (isRestDay) {
        type = "other";
      } else if (lowerTitle.includes("torneo") || lowerTitle.includes("competencia") || lowerTitle.includes("campeonato") || lowerTitle.includes("clasificatorio")) {
        type = "competition";
      } else if (lowerTitle.includes("reunión") || lowerTitle.includes("reunion") || lowerTitle.includes("charla") || lowerTitle.includes("junta")) {
        type = "meeting";
      }

      dailyEntries.push({
        date,
        title: finalTitle,
        targetArrows: isRestDay ? 0 : targetArrows,
        focusPoints,
        notes,
        type,
        isRestDay
      });
    });

    if (dailyEntries.length === 0) {
      return {
        success: false,
        mode: "daily",
        planName: defaultCycleName,
        startDate: todayStr,
        endDate: todayStr,
        totalVolumeGoal: 0,
        stages: [],
        dailyEntries: [],
        warnings: [],
        error: "No se pudieron identificar días válidos en las filas proporcionadas."
      };
    }

    // Sort chronologically
    dailyEntries.sort((a, b) => a.date.localeCompare(b.date));

    const startDate = dailyEntries[0].date;
    const endDate = dailyEntries[dailyEntries.length - 1].date;
    const totalVolumeGoal = dailyEntries.reduce((sum, d) => sum + d.targetArrows, 0);

    // Also synthesize summary stages by month/week so the plan can be viewed in the Macrocycle tab
    const monthGroups = new Map<string, ParsedDailyEntry[]>();
    dailyEntries.forEach((entry) => {
      const ym = entry.date.slice(0, 7); // YYYY-MM
      if (!monthGroups.has(ym)) monthGroups.set(ym, []);
      monthGroups.get(ym)!.push(entry);
    });

    const synthesizedStages: MacrocyclePhase[] = [];
    let colorIdx = 0;
    monthGroups.forEach((entries, ym) => {
      const firstD = entries[0].date;
      const lastD = entries[entries.length - 1].date;
      const trainingDays = entries.filter((e) => !e.isRestDay);
      const totalArrowsInGroup = entries.reduce((s, e) => s + e.targetArrows, 0);
      const spanWeeks = Math.max(1, entries.length / 7);
      const weeklySessions = Math.min(7, Math.max(1, Math.round(trainingDays.length / spanWeeks)));
      const weeklyArrows = Math.max(60, Math.round(totalArrowsInGroup / spanWeeks));

      const dateObj = new Date(firstD + "T12:00:00");
      const monthLabel = dateObj.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
      const capitalizedMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

      synthesizedStages.push({
        id: `etapa-daily-${ym}-${colorIdx}`,
        name: `Plan Diario · ${capitalizedMonth}`,
        startDate: firstD,
        endDate: lastD,
        weeklySessionGoal: weeklySessions,
        weeklyArrowGoal: weeklyArrows,
        notes: `${entries.length} días programados (${trainingDays.length} días de tiro, ${totalArrowsInGroup} flechas en total).`,
        color: ETAPA_COLORS[colorIdx % ETAPA_COLORS.length].color
      });
      colorIdx++;
    });

    return {
      success: true,
      mode: "daily",
      planName: defaultCycleName,
      startDate,
      endDate,
      totalVolumeGoal: Math.max(totalVolumeGoal, 100),
      stages: synthesizedStages,
      dailyEntries,
      warnings
    };
  }

  // ============================================================================
  // MODE 2: STAGE / RANGE ("stages") IMPORT
  // ============================================================================
  let nameCol = 0;
  let startCol = 1;
  let endCol = 2;
  let sessionsCol = 3;
  let arrowsCol = 4;
  let notesCol = 5;

  if (isHeader) {
    firstRowLower.forEach((header, idx) => {
      if (header.includes("etapa") || header.includes("nombre") || header.includes("fase")) nameCol = idx;
      else if (header.includes("inicio") || (header.includes("desde") && !header.includes("fin"))) startCol = idx;
      else if (header.includes("fin") || header.includes("hasta")) endCol = idx;
      else if (header.includes("sesion") || header.includes("dias") || header.includes("días")) sessionsCol = idx;
      else if (header.includes("flecha") || header.includes("tiros") || header.includes("volumen")) arrowsCol = idx;
      else if (header.includes("nota") || header.includes("enfoque") || header.includes("indicacion") || header.includes("detalle")) notesCol = idx;
    });
  }

  const parsedStages: MacrocyclePhase[] = [];
  let currentEstimatedStartDate = todayStr;

  dataRows.forEach((row, idx) => {
    if (row.length === 0 || (row.length === 1 && !row[0])) return;

    const rawName = row[nameCol] || `Etapa ${idx + 1}`;
    const rawStart = row[startCol];
    const rawEnd = row[endCol];

    const startDate = normalizeDateString(rawStart, currentEstimatedStartDate);
    let endDate = normalizeDateString(
      rawEnd,
      new Date(new Date(startDate).getTime() + 21 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
    );

    if (endDate < startDate) {
      endDate = new Date(new Date(startDate).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    }

    const rawSessions = row[sessionsCol];
    const sessions = parseInt(rawSessions || "3", 10) || 3;

    const rawArrows = row[arrowsCol];
    const arrows = parseInt((rawArrows || "300").replace(/[^0-9]/g, ""), 10) || 300;

    const notes = row[notesCol] || "";
    const color = ETAPA_COLORS[idx % ETAPA_COLORS.length].color;

    parsedStages.push({
      id: `etapa-imp-${Date.now()}-${idx + 1}`,
      name: rawName,
      startDate,
      endDate,
      weeklySessionGoal: Math.min(7, Math.max(1, sessions)),
      weeklyArrowGoal: Math.max(0, arrows),
      notes,
      color
    });

    currentEstimatedStartDate = new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  });

  if (parsedStages.length === 0) {
    return {
      success: false,
      mode: "stages",
      planName: defaultCycleName,
      startDate: todayStr,
      endDate: todayStr,
      totalVolumeGoal: 0,
      stages: [],
      dailyEntries: [],
      warnings: [],
      error: "No se pudieron identificar etapas válidas en las filas proporcionadas."
    };
  }

  const cycleStartDate = parsedStages[0].startDate;
  const cycleEndDate = parsedStages[parsedStages.length - 1].endDate;

  let totalVolumeGoal = 0;
  parsedStages.forEach((st) => {
    const startMs = new Date(st.startDate).getTime();
    const endMs = new Date(st.endDate).getTime();
    const weeks = Math.max(1, Math.round((endMs - startMs) / (7 * 24 * 60 * 60 * 1000)));
    totalVolumeGoal += st.weeklyArrowGoal * weeks;
  });

  return {
    success: true,
    mode: "stages",
    planName: defaultCycleName,
    startDate: cycleStartDate,
    endDate: cycleEndDate,
    totalVolumeGoal: Math.max(1000, totalVolumeGoal),
    stages: parsedStages,
    dailyEntries: [],
    warnings
  };
}

/**
 * Returns a ready-to-use CSV sample text for Coaches (Stages format)
 */
export function generateSampleCsvTemplate(): string {
  const today = new Date();
  const d1 = today.toISOString().split("T")[0];
  const d2 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const d3 = new Date(today.getTime() + 31 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const d4 = new Date(today.getTime() + 65 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const d5 = new Date(today.getTime() + 66 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const d6 = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  return [
    "Nombre de la Etapa,Fecha Inicio,Fecha Fin,Sesiones por Semana,Flechas por Semana,Notas para los Arqueros",
    `Base y Acondicionamiento,${d1},${d2},3,300,"Fuerza específica, banda elástica y técnica de anclaje"`,
    `Aumento de Volumen,${d3},${d4},4,600,"Disparo continuo, ritmo regular por flecha y resistencia"`,
    `Puesta a Punto y Duelos,${d5},${d6},3,400,"Simulacro de eliminatorias 1 contra 1 bajo tiempo oficial"`
  ].join("\r\n");
}

/**
 * Returns a ready-to-use Day-by-Day CSV sample text for Coaches & Athletes
 */
export function generateDailySampleCsvTemplate(): string {
  const today = new Date();
  const dayStr = (offset: number) =>
    new Date(today.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  return [
    "Fecha,Actividad,Flechas,Enfoque Técnico,Notas del Entrenador",
    `${dayStr(0)},Volumen Técnico 70m,120,"Anclaje firme, Expansión dorsal","Tirar en series de 6 flechas controlando el ritmo"`,
    `${dayStr(1)},Trabajo con Liga y 18m,90,"Alineación de hombros, Soltada limpia","15 min de banda elástica antes de tirar"`,
    `${dayStr(2)},Descanso Activo,0,"Movilidad articular, Estiramiento","Recuperación muscular e hidratación"`,
    `${dayStr(3)},Control Oficial WA 720,144,"Tiempo oficial 240s, Enfoque en el clic","Anotar las 2 rondas completas en la app"`,
    `${dayStr(4)},Simulacro de Duelos (Matchplay),96,"Respiración bajo presión, Primera flecha fuerte","Disparar sets de 3 flechas en 20 segundos por flecha"`
  ].join("\r\n");
}

/**
 * Triggers a browser download of the Stages sample template in CSV/Excel format
 */
export function downloadSampleTemplate(): void {
  const csvContent = "\uFEFF" + generateSampleCsvTemplate();
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "Plantilla_Por_Etapas_Archery101010.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Triggers a browser download of the Day-by-Day sample template in CSV/Excel format
 */
export function downloadDailySampleTemplate(): void {
  const csvContent = "\uFEFF" + generateDailySampleCsvTemplate();
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "Plantilla_Dia_Por_Dia_Archery101010.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports an existing cycle into an Excel-ready CSV file
 */
export function exportCycleToCsv(cycle: Macrocycle): void {
  const rows = [
    ["Nombre de la Etapa", "Fecha Inicio", "Fecha Fin", "Sesiones por Semana", "Flechas por Semana", "Notas para los Arqueros"]
  ];

  cycle.phases.forEach((p) => {
    rows.push([
      `"${p.name.replace(/"/g, '""')}"`,
      p.startDate,
      p.endDate,
      String(p.weeklySessionGoal),
      String(p.weeklyArrowGoal),
      `"${(p.notes || "").replace(/"/g, '""')}"`
    ]);
  });

  const csvContent = "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const safeName = cycle.name.replace(/[^a-zA-Z0-9_\-]/g, "_");
  link.setAttribute("download", `Plan_${safeName}_Archery101010.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
