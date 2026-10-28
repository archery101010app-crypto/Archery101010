import * as XLSX from "xlsx";
import { Macrocycle, MacrocyclePhase, ETAPA_COLORS } from "@/lib/db/macrocycleTypes";

export interface ParsedDailyEntry {
  date: string; // YYYY-MM-DD
  title: string;
  targetArrows: number;
  focusPoints: string[];
  notes: string;
  customFields?: Array<{ label: string; value: string }>;
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
  headers?: string[];
  warnings: string[];
  error?: string;
}

const SPANISH_MONTHS: Record<string, string> = {
  ene: "01", enero: "01", jan: "01", january: "01",
  feb: "02", febrero: "02", february: "02",
  mar: "03", marzo: "03", march: "03",
  abr: "04", abril: "04", apr: "04", april: "04",
  may: "05", mayo: "05",
  jun: "06", junio: "06", june: "06",
  jul: "07", julio: "07", july: "07",
  ago: "08", agosto: "08", aug: "08", august: "08",
  sep: "09", sept: "09", septiembre: "09", set: "09", september: "09",
  oct: "10", octubre: "10", october: "10",
  nov: "11", noviembre: "11", november: "11",
  dic: "12", diciembre: "12", dec: "12", december: "12"
};

const DAY_NAMES_REGEX = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|lun|mar|mi[eé]|jue|vie|s[aá]b|dom|mon|tue|wed|thu|fri|sat|sun)\b[\s,\.\-:]*/i;

/**
 * Converts an Excel serial date number (e.g. 46323) to YYYY-MM-DD
 */
export function excelSerialToYMD(serial: number): string | null {
  if (isNaN(serial) || serial < 40000 || serial > 60000) return null;
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400 * 1000;
  const dateInfo = new Date(utcValue);
  if (isNaN(dateInfo.getTime())) return null;
  const y = dateInfo.getUTCFullYear();
  const m = String(dateInfo.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateInfo.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Checks if a raw cell string looks like a valid calendar date
 */
export function isValidDateCell(raw?: string): boolean {
  if (!raw) return false;
  const cleaned = raw.trim().replace(DAY_NAMES_REGEX, "").trim().toLowerCase();
  if (!cleaned) return false;

  // Excel serial date (40000..60000)
  if (/^\d{5}(?:\.\d+)?$/.test(cleaned)) {
    const num = parseFloat(cleaned);
    if (num >= 43000 && num <= 55000) return true;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/.test(cleaned)) return true;

  // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY
  if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(cleaned)) return true;

  // Short DD/MM or DD-MM (without year, e.g. "28/10" or "05-11")
  const dmMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dmMatch) {
    const d = parseInt(dmMatch[1], 10);
    const m = parseInt(dmMatch[2], 10);
    if ((d >= 1 && d <= 31 && m >= 1 && m <= 12) || (m >= 1 && m <= 31 && d >= 1 && d <= 12)) {
      return true;
    }
  }

  // DD de mes de YYYY or DD mes YYYY or DD-mes (e.g., "15 oct 2026", "15-oct", "28 de octubre")
  const textMonthMatch = cleaned.match(/^(\d{1,2})(?:\s*de\s*|[\/\-\.\s]+)([a-záéíóú]{3,12})(?:(?:\s*de\s*|[\/\-\.\s]+)(\d{2,4}))?$/);
  if (textMonthMatch) {
    const monthWord = textMonthMatch[2];
    if (SPANISH_MONTHS[monthWord] || SPANISH_MONTHS[monthWord.slice(0, 3)]) return true;
  }

  // Month DD, YYYY or Month DD (e.g. "Oct 28", "Octubre 28, 2026")
  const monthFirstMatch = cleaned.match(/^([a-záéíóú]{3,12})[\s\-\.]+(\d{1,2})(?:[\s,\-\.]+(\d{2,4}))?$/);
  if (monthFirstMatch) {
    const monthWord = monthFirstMatch[1];
    if (SPANISH_MONTHS[monthWord] || SPANISH_MONTHS[monthWord.slice(0, 3)]) return true;
  }

  // Embedded full date inside text (e.g. "Lunes 26/10/2026")
  if (/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/.test(cleaned)) return true;
  if (/\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/.test(cleaned)) return true;

  return false;
}

/**
 * Normalizes dates from any common format into YYYY-MM-DD
 */
export function normalizeDateString(raw: string, fallbackDate: string, referenceYear?: number, referenceMonth?: number): string {
  if (!raw) return fallbackDate;
  const refY = referenceYear || new Date().getFullYear();
  const refM = referenceMonth || (new Date().getMonth() + 1);

  const trimmed = raw.trim().replace(DAY_NAMES_REGEX, "").trim().toLowerCase();
  if (!trimmed) return fallbackDate;

  // Excel serial number
  if (/^\d{5}(?:\.\d+)?$/.test(trimmed)) {
    const serialDate = excelSerialToYMD(parseFloat(trimmed));
    if (serialDate) return serialDate;
  }

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Embedded YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = trimmed.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY
  const dmyMatch = trimmed.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmyMatch) {
    let [, d, m, y] = dmyMatch;
    if (y.length === 2) {
      y = `20${y}`;
    }
    const mNum = parseInt(m, 10);
    const dNum = parseInt(d, 10);
    if (mNum > 12 && dNum <= 12) {
      return `${y}-${d.padStart(2, "0")}-${m.padStart(2, "0")}`;
    }
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD mes YYYY or DD-mes (e.g. "26 oct 2026", "26 de octubre", "26-oct")
  const textMonthMatch = trimmed.match(/(\d{1,2})(?:\s*de\s*|[\/\-\.\s]+)([a-záéíóú]{3,12})(?:(?:\s*de\s*|[\/\-\.\s]+)(\d{2,4}))?/);
  if (textMonthMatch) {
    const [, d, monthWord, rawYear] = textMonthMatch;
    const monthCode = SPANISH_MONTHS[monthWord] || SPANISH_MONTHS[monthWord.slice(0, 3)];
    if (monthCode) {
      let y = rawYear || String(refY);
      if (y.length === 2) y = `20${y}`;
      return `${y}-${monthCode}-${d.padStart(2, "0")}`;
    }
  }

  // Month DD, YYYY (e.g. "Oct 28", "Octubre 28 2026")
  const monthFirstMatch = trimmed.match(/^([a-záéíóú]{3,12})[\s\-\.]+(\d{1,2})(?:[\s,\-\.]+(\d{2,4}))?/);
  if (monthFirstMatch) {
    const [, monthWord, d, rawYear] = monthFirstMatch;
    const monthCode = SPANISH_MONTHS[monthWord] || SPANISH_MONTHS[monthWord.slice(0, 3)];
    if (monthCode) {
      let y = rawYear || String(refY);
      if (y.length === 2) y = `20${y}`;
      return `${y}-${monthCode}-${d.padStart(2, "0")}`;
    }
  }

  // Short DD/MM or DD-MM (without year, e.g. "28/10")
  const dmMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dmMatch) {
    const dNum = parseInt(dmMatch[1], 10);
    const mNum = parseInt(dmMatch[2], 10);
    if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12) {
      return `${refY}-${String(mNum).padStart(2, "0")}-${String(dNum).padStart(2, "0")}`;
    }
    if (mNum >= 1 && mNum <= 31 && dNum >= 1 && dNum <= 12) {
      return `${refY}-${String(dNum).padStart(2, "0")}-${String(mNum).padStart(2, "0")}`;
    }
  }

  // Plain day of month number (1..31) e.g. "28" or "Lunes 28"
  const dayOnlyMatch = trimmed.match(/^(\d{1,2})$/);
  if (dayOnlyMatch) {
    const dayNum = parseInt(dayOnlyMatch[1], 10);
    if (dayNum >= 1 && dayNum <= 31) {
      return `${refY}-${String(refM).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    }
  }

  return fallbackDate;
}

/**
 * Parses an Excel (.xlsx / .xls / .csv) ArrayBuffer using SheetJS (XLSX)
 * Returns the list of sheet names and a helper to extract TSV text from any sheet.
 */
export function parseExcelWorkbookBuffer(buffer: ArrayBuffer): {
  sheetNames: string[];
  getSheetTsv: (sheetName: string) => string;
} {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, raw: false });
  const sheetNames = workbook.SheetNames || [];

  const getSheetTsv = (sheetName: string): string => {
    const ws = workbook.Sheets[sheetName];
    if (!ws) return "";

    // Convert worksheet to 2D array of values
    const rawMatrix = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
      dateNF: "yyyy-mm-dd"
    });

    const formattedRows = rawMatrix
      .map((row) => {
        if (!Array.isArray(row)) return "";
        return row
          .map((cell) => {
            if (cell === null || cell === undefined) return "";
            if (cell instanceof Date && !isNaN(cell.getTime())) {
              const y = cell.getFullYear();
              const m = String(cell.getMonth() + 1).padStart(2, "0");
              const d = String(cell.getDate()).padStart(2, "0");
              return `${y}-${m}-${d}`;
            }
            // Replace internal tabs or newlines with space/comma so TSV stays clean
            return String(cell).replace(/\t/g, " ").replace(/\r?\n/g, " · ").trim();
          })
          .join("\t");
      })
      .filter((line) => line.replace(/\t/g, "").trim().length > 0);

    return formattedRows.join("\n");
  };

  return { sheetNames, getSheetTsv };
}

/**
 * Extracts a Google Sheets ID from any shared URL and fetches its CSV content directly.
 * Uses multiple fallback endpoints (/gviz/tq and /export?format=csv) for maximum compatibility.
 */
export async function fetchGoogleSheetCsv(sheetUrl: string): Promise<{ ok: boolean; csv?: string; error?: string }> {
  try {
    const trimmed = sheetUrl.trim();

    // Support published links (/spreadsheets/d/e/2PACX-.../pub)
    if (trimmed.includes("/spreadsheets/d/e/")) {
      const pubBase = trimmed.split("?")[0].replace(/\/pubhtml$/, "/pub");
      const pubUrl = `${pubBase}?output=csv`;
      const resp = await fetch(pubUrl);
      if (resp.ok) {
        const text = await resp.text();
        if (text && !text.trim().startsWith("<!DOCTYPE html>") && !text.trim().startsWith("<html")) {
          return { ok: true, csv: text };
        }
      }
    }

    const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) {
      return {
        ok: false,
        error: "El enlace no parece ser un documento válido de Google Sheets."
      };
    }

    const sheetId = idMatch[1];
    const gidMatch = trimmed.match(/[#&?]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : "";

    // Candidate URLs in order of reliability across mobile/desktop browsers
    const candidateUrls = [
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ""}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ""}`
    ];

    for (const url of candidateUrls) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const csvText = await response.text();
        const csvLower = (csvText || "").toLowerCase();
        if (
          csvText &&
          csvText.trim().length > 0 &&
          !csvText.trim().startsWith("<!DOCTYPE html>") &&
          !csvText.trim().startsWith("<html") &&
          !csvLower.includes("offline mode active") &&
          !csvLower.includes("connect to the internet") &&
          !csvLower.includes("accounts.google.com/servicelogin")
        ) {
          return { ok: true, csv: csvText };
        }
      } catch {
        // try next endpoint
      }
    }

    return {
      ok: false,
      error: "No se pudo leer la hoja. En Google Sheets toca 'Compartir' y cámbialo a 'Cualquier persona con el enlace (Lector)', o copia y pega las celdas directamente."
    };
  } catch {
    return {
      ok: false,
      error: "No se pudo conectar con Google Sheets. Puedes copiar las celdas de tu hoja y pegarlas directamente en la pestaña 'Pegar Celdas'."
    };
  }
}

/**
 * RFC-4180 compliant multi-line CSV / TSV parser.
 * Properly preserves multi-line quoted cells without splitting rows prematurely.
 */
export function parseDelimitedTextToMatrix(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, "").trim();
  if (!text) return [];

  // Determine delimiter by inspecting outside quotes in the first 1000 chars
  const sample = text.slice(0, 1500);
  let tabCount = 0;
  let semiCount = 0;
  let commaCount = 0;
  let inQuotes = false;

  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === "\t") tabCount++;
      else if (ch === ";") semiCount++;
      else if (ch === ",") commaCount++;
    }
  }

  let delimiter = "\t";
  if (tabCount > 0 && tabCount >= semiCount && tabCount >= commaCount) {
    delimiter = "\t";
  } else if (semiCount > commaCount && semiCount > 0) {
    delimiter = ";";
  } else if (commaCount > 0) {
    delimiter = ",";
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && ch === delimiter) {
      currentRow.push(currentCell.replace(/\r?\n/g, " · ").trim());
      currentCell = "";
    } else if (!inQuotes && (ch === "\n" || (ch === "\r" && next === "\n"))) {
      if (ch === "\r") i++;
      currentRow.push(currentCell.replace(/\r?\n/g, " · ").trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += ch;
    }
  }

  // Push last cell/row
  currentRow.push(currentCell.replace(/\r?\n/g, " · ").trim());
  if (currentRow.some((c) => c.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Helper to check if a header cell represents a specific semantic column
 */
function classifyHeader(hRaw: string): "date" | "startDate" | "endDate" | "title" | "arrows" | "focus" | "notes" | "sessions" | "unknown" {
  const h = hRaw.trim().toLowerCase();
  if (!h) return "unknown";

  if (h.includes("inicio") || h.includes("desde") || h.includes("start")) return "startDate";
  if (h.includes("fin") || h.includes("hasta") || h.includes("end")) return "endDate";
  if (h === "fecha" || h.includes("fecha") || h === "día" || h === "dia" || h.startsWith("día ") || h.startsWith("dia ") || h === "date" || h === "day") return "date";
  if (h.includes("sesion") || h.includes("sesión") && h.includes("sem")) return "sessions";
  if (h.includes("flecha") || h.includes("volumen") || h.includes("tiros") || h.includes("arrows") || h.includes("cant")) return "arrows";
  if (h.includes("actividad") || h.includes("tarea") || h.includes("entrenamiento") || h.includes("trabajo") || h.includes("ejercicio") || h.includes("rutina") || h.includes("sesión") || h.includes("sesion") || h.includes("título") || h.includes("titulo") || h.includes("etapa") || h.includes("fase") || h.includes("nombre") || h.includes("plan")) return "title";
  if (h.includes("enfoque") || h.includes("técnica") || h.includes("tecnica") || h.includes("foco") || h.includes("objetivo")) return "focus";
  if (h.includes("nota") || h.includes("indicacion") || h.includes("indicación") || h.includes("observacion") || h.includes("observación") || h.includes("detalle") || h.includes("comentario") || h.includes("descrip")) return "notes";

  return "unknown";
}

/**
 * Parses raw text from Excel, Google Sheets, or CSV file.
 * Preserves 100% literal text from the user's spreadsheet without inventing any text or fake arrow counts.
 */
export function parseSpreadsheetData(rawText: string, defaultCycleName = "Plan Importado"): ParsedCycleResult {
  const warnings: string[] = [];
  const todayStr = new Date().toISOString().split("T")[0];

  const cleanRawLower = (rawText || "").toLowerCase();
  if (!rawText || !rawText.trim() || cleanRawLower.includes("offline mode active") || cleanRawLower.includes("connect to the internet")) {
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
      error: cleanRawLower.includes("offline mode active") || cleanRawLower.includes("connect to the internet")
        ? "No se pudo acceder a la hoja porque no hay conexión a internet activa."
        : "No se encontraron celdas para importar."
    };
  }

  const rows = parseDelimitedTextToMatrix(rawText);
  if (rows.length === 0) {
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
      error: "El documento está vacío."
    };
  }

  // Try to detect reference month/year if mentioned in a top banner row (e.g. "NOVIEMBRE 2026" or "Plan Octubre")
  let refYear = new Date().getFullYear();
  let refMonth = new Date().getMonth() + 1;
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const joined = rows[r].join(" ").toLowerCase();
    const yearMatch = joined.match(/\b(202\d|203\d)\b/);
    if (yearMatch) refYear = parseInt(yearMatch[1], 10);
    for (const [mWord, mCode] of Object.entries(SPANISH_MONTHS)) {
      if (mWord.length >= 4 && joined.includes(mWord)) {
        refMonth = parseInt(mCode, 10);
        break;
      }
    }
  }

  // Find the first row that looks like either a header row or a data row with a date
  let headerRowIdx = -1;
  let firstDataRowIdx = 0;

  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r];
    const nonEmptyCount = row.filter((c) => c.trim().length > 0).length;
    if (nonEmptyCount === 0) continue;

    const classifications = row.map(classifyHeader);
    const recognizedHeaders = classifications.filter((c) => c !== "unknown").length;
    const hasDateCellInRow = row.some((c) => isValidDateCell(c));

    if (recognizedHeaders >= 1 && !hasDateCellInRow) {
      headerRowIdx = r;
      firstDataRowIdx = r + 1;
      break;
    }

    if (hasDateCellInRow) {
      firstDataRowIdx = r;
      if (r > 0 && rows[r - 1].filter((c) => c.trim().length > 0).length >= 2) {
        headerRowIdx = r - 1;
      }
      break;
    }
  }

  const headerRow = headerRowIdx >= 0 ? rows[headerRowIdx] : [];
  const dataRows = rows.slice(firstDataRowIdx).filter((r) => r.some((c) => c.trim().length > 0));

  if (dataRows.length === 0) {
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
      error: "Solo se encontró la fila de encabezados. Agrega al menos una fila con datos."
    };
  }

  // Check if this is a STAGE RANGES table (explicit Start Date AND End Date columns)
  const headerClasses = headerRow.map(classifyHeader);
  const hasStartAndEndHeaders =
    headerClasses.includes("startDate") && headerClasses.includes("endDate");

  // Count how many rows have 2 valid dates vs 1 valid date
  let rowsWithTwoDates = 0;
  let rowsWithOneDate = 0;
  for (const r of dataRows.slice(0, 15)) {
    const dateCols = r.filter((c) => isValidDateCell(c)).length;
    if (dateCols >= 2) rowsWithTwoDates++;
    else if (dateCols === 1) rowsWithOneDate++;
  }

  const isStagesMode = hasStartAndEndHeaders || (rowsWithTwoDates > rowsWithOneDate && rowsWithTwoDates >= 1);

  // ============================================================================
  // MODE 1: DAY-BY-DAY ("daily") LITERAL IMPORT (Default & Most Common)
  // ============================================================================
  if (!isStagesMode) {
    // Identify which column is the Date column
    let dateCol = headerClasses.indexOf("date");
    if (dateCol === -1) {
      // Score each column by how many rows have a valid date in that column
      const maxCols = Math.max(...dataRows.map((r) => r.length), 1);
      let bestCol = 0;
      let bestScore = -1;
      for (let c = 0; c < maxCols; c++) {
        let score = 0;
        for (const r of dataRows) {
          if (isValidDateCell(r[c])) score += 3;
          else if (r[c] && /^\d{1,2}$/.test(r[c].trim())) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestCol = c;
        }
      }
      dateCol = bestCol;
    }

    let titleCol = headerClasses.indexOf("title");
    let arrowsCol = headerClasses.indexOf("arrows");
    let focusCol = headerClasses.indexOf("focus");
    let notesCol = headerClasses.indexOf("notes");

    // If no header explicitly matched arrows, check if there is a purely numeric column (other than dateCol)
    const maxCols = Math.max(...dataRows.map((r) => r.length), headerRow.length, 1);
    if (arrowsCol === -1 && maxCols >= 3) {
      for (let c = 0; c < maxCols; c++) {
        if (c === dateCol || c === titleCol || c === focusCol || c === notesCol) continue;
        const hText = (headerRow[c] || "").toLowerCase();
        if (hText && !hText.includes("flecha") && !hText.includes("volumen") && !hText.includes("tiro") && !hText.includes("cant") && !hText.includes("meta")) {
          // If it has a specific non-arrow header (like "Distancia" or "Series"), don't guess it as arrowsCol
          continue;
        }
        const nonEmptyVals = dataRows.map((r) => (r[c] || "").trim()).filter(Boolean);
        if (nonEmptyVals.length > 0 && nonEmptyVals.every((v) => /^\d+(\s*(fl|flechas|tiros))?$/i.test(v))) {
          arrowsCol = c;
          break;
        }
      }
    }

    // If titleCol not explicitly found by header, pick the first non-date text column
    if (titleCol === -1) {
      for (let c = 0; c < maxCols; c++) {
        if (c !== dateCol && c !== arrowsCol) {
          titleCol = c;
          break;
        }
      }
    }

    const dailyMap = new Map<string, ParsedDailyEntry>();
    let rollingDate = `${refYear}-${String(refMonth).padStart(2, "0")}-01`;

    dataRows.forEach((row) => {
      if (row.every((c) => !c || !c.trim())) return;

      const rawDateCell = (row[dateCol] || "").trim();

      // Skip repeated header rows inside the sheet
      if (classifyHeader(rawDateCell) === "date" && !isValidDateCell(rawDateCell)) {
        return;
      }

      // Check if this row has a valid date or day number
      const hasValidDate = isValidDateCell(rawDateCell) || /^\d{1,2}$/.test(rawDateCell.replace(DAY_NAMES_REGEX, "").trim());
      if (!hasValidDate && dataRows.length > 1) {
        // Check if any OTHER cell in the row has a date (in case of shifted columns)
        const altDateIdx = row.findIndex((c) => isValidDateCell(c));
        if (altDateIdx === -1) {
          // If row has no date at all, skip section dividers that have only 1 cell
          const nonEmptyCells = row.filter((c) => c && c.trim().length > 0);
          if (nonEmptyCells.length <= 1) return;
        }
      }

      const date = normalizeDateString(rawDateCell, rollingDate, refYear, refMonth);
      const nextDayObj = new Date(new Date(date + "T12:00:00").getTime() + 24 * 60 * 60 * 1000);
      if (!isNaN(nextDayObj.getTime())) {
        rollingDate = nextDayObj.toISOString().split("T")[0];
      }

      // Extract arrows ONLY if explicitly present in the sheet (NEVER invent 120!)
      let targetArrows = 0;
      if (arrowsCol !== -1 && row[arrowsCol] !== undefined) {
        const rawArrowsStr = String(row[arrowsCol]).trim();
        const numMatch = rawArrowsStr.match(/\d+/);
        if (numMatch) {
          targetArrows = parseInt(numMatch[0], 10) || 0;
        }
      }

      // Collect all literal columns from this row
      const rawTitle = titleCol !== -1 && row[titleCol] ? row[titleCol].trim() : "";
      const rawFocus = focusCol !== -1 && row[focusCol] ? row[focusCol].trim() : "";
      const rawNotes = notesCol !== -1 && row[notesCol] ? row[notesCol].trim() : "";

      // Also collect any OTHER columns in the sheet so 100% of the user's columns are preserved literally!
      const customFields: Array<{ label: string; value: string }> = [];
      const extraTextParts: string[] = [];

      for (let c = 0; c < row.length; c++) {
        if (c === dateCol) continue;
        const val = (row[c] || "").trim();
        if (!val) continue;

        const colHeader = (headerRow[c] || "").trim();
        if (colHeader) {
          customFields.push({ label: colHeader, value: val });
        }

        if (c !== titleCol && c !== arrowsCol && c !== focusCol && c !== notesCol) {
          if (colHeader) {
            extraTextParts.push(`${colHeader}: ${val}`);
          } else {
            extraTextParts.push(val);
          }
        }
      }

      // If arrows wasn't in a dedicated column, check if the title or another cell mentions "120 flechas" or "120 fl"
      if (targetArrows === 0) {
        const joinedRowText = row.filter((_, idx) => idx !== dateCol).join(" ");
        const inlineArrowsMatch = joinedRowText.match(/\b(\d{1,4})\s*(?:flechas|flecha|fl\.?|tiros|arrows)\b/i);
        if (inlineArrowsMatch) {
          targetArrows = parseInt(inlineArrowsMatch[1], 10) || 0;
        }
      }

      // Build literal title:
      // 1. Exact rawTitle if present
      // 2. Otherwise first non-empty extra column text
      // 3. Otherwise if targetArrows > 0, literal number from the arrow cell
      let literalTitle = rawTitle;
      if (!literalTitle && extraTextParts.length > 0) {
        literalTitle = extraTextParts.shift()!;
      }
      if (!literalTitle && rawFocus) {
        literalTitle = rawFocus;
      }
      if (!literalTitle && rawNotes) {
        literalTitle = rawNotes;
      }
      if (!literalTitle && arrowsCol !== -1 && row[arrowsCol]?.trim()) {
        literalTitle = row[arrowsCol].trim();
      }

      // If the entire row apart from the date was empty, skip it so we don't invent fake tasks on blank calendar rows!
      if (!literalTitle && targetArrows === 0 && !rawFocus && !rawNotes && extraTextParts.length === 0) {
        return;
      }

      const lowerAll = `${literalTitle} ${rawNotes} ${rawFocus}`.toLowerCase();
      const isRestWord =
        lowerAll === "descanso" ||
        lowerAll.includes("descanso") ||
        lowerAll.includes("libre") ||
        lowerAll === "rest" ||
        lowerAll === "off";

      const isRestDay = isRestWord && targetArrows === 0;

      const focusPoints = rawFocus
        ? rawFocus.split(/[,;•|]/).map((s) => s.trim()).filter(Boolean)
        : [];

      const combinedNotes = [rawNotes, ...extraTextParts].filter(Boolean).join(" · ");

      let type: "training" | "competition" | "meeting" | "other" = "training";
      if (isRestDay) {
        type = "other";
      } else if (lowerAll.includes("torneo") || lowerAll.includes("competencia") || lowerAll.includes("campeonato") || lowerAll.includes("clasificatorio")) {
        type = "competition";
      } else if (lowerAll.includes("reunión") || lowerAll.includes("reunion") || lowerAll.includes("charla") || lowerAll.includes("junta")) {
        type = "meeting";
      }

      if (dailyMap.has(date)) {
        // Merge with existing entry on the same date so multiple rows for the same day are never lost
        const existing = dailyMap.get(date)!;
        if (literalTitle && !existing.title.includes(literalTitle)) {
          existing.title = existing.title ? `${existing.title} / ${literalTitle}` : literalTitle;
        }
        existing.targetArrows += targetArrows;
        focusPoints.forEach((fp) => {
          if (!existing.focusPoints.includes(fp)) existing.focusPoints.push(fp);
        });
        if (combinedNotes && !existing.notes.includes(combinedNotes)) {
          existing.notes = existing.notes ? `${existing.notes} | ${combinedNotes}` : combinedNotes;
        }
        if (customFields.length > 0) {
          existing.customFields = [...(existing.customFields || []), ...customFields];
        }
        existing.isRestDay = existing.isRestDay && isRestDay;
        if (type === "competition") existing.type = "competition";
      } else {
        dailyMap.set(date, {
          date,
          title: literalTitle,
          targetArrows,
          focusPoints,
          notes: combinedNotes,
          customFields: customFields.length > 0 ? customFields : undefined,
          type,
          isRestDay
        });
      }
    });

    const dailyEntries = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

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
        error: "No se encontraron filas con fechas o actividades válidas en el documento."
      };
    }

    const startDate = dailyEntries[0].date;
    const endDate = dailyEntries[dailyEntries.length - 1].date;
    const totalVolumeGoal = dailyEntries.reduce((sum, d) => sum + d.targetArrows, 0);

    // Group by month for Macrocycle timeline compatibility without inventing fake notes
    const monthGroups = new Map<string, ParsedDailyEntry[]>();
    dailyEntries.forEach((entry) => {
      const ym = entry.date.slice(0, 7);
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
      const weeklyArrows = Math.round(totalArrowsInGroup / spanWeeks);

      synthesizedStages.push({
        id: `etapa-daily-${ym}-${colorIdx}`,
        name: defaultCycleName,
        startDate: firstD,
        endDate: lastD,
        weeklySessionGoal: weeklySessions,
        weeklyArrowGoal: weeklyArrows,
        notes: "",
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
      totalVolumeGoal,
      stages: synthesizedStages,
      dailyEntries,
      headers: headerRow.length > 0 ? headerRow : undefined,
      warnings
    };
  }

  // ============================================================================
  // MODE 2: STAGE / RANGE ("stages") LITERAL IMPORT
  // ============================================================================
  let nameCol = headerClasses.indexOf("title");
  let startCol = headerClasses.indexOf("startDate");
  let endCol = headerClasses.indexOf("endDate");
  let sessionsCol = headerClasses.indexOf("sessions");
  let arrowsCol = headerClasses.indexOf("arrows");
  let notesCol = headerClasses.indexOf("notes");

  if (nameCol === -1) nameCol = 0;
  if (startCol === -1) startCol = 1;
  if (endCol === -1) endCol = 2;
  if (sessionsCol === -1) sessionsCol = 3;
  if (arrowsCol === -1) arrowsCol = 4;
  if (notesCol === -1) notesCol = 5;

  const parsedStages: MacrocyclePhase[] = [];
  let currentEstimatedStartDate = todayStr;

  dataRows.forEach((row, idx) => {
    if (row.every((c) => !c || !c.trim())) return;

    const rawName = (row[nameCol] || "").trim();
    const rawStart = (row[startCol] || "").trim();
    const rawEnd = (row[endCol] || "").trim();
    if (!rawName && !rawStart && !rawEnd) return;

    const startDate = normalizeDateString(rawStart, currentEstimatedStartDate, refYear, refMonth);
    let endDate = normalizeDateString(rawEnd, startDate, refYear, refMonth);
    if (endDate < startDate) endDate = startDate;

    const rawSessions = row[sessionsCol] || "";
    const sessions = parseInt(String(rawSessions).replace(/[^0-9]/g, ""), 10) || 0;

    const rawArrows = row[arrowsCol] || "";
    const arrows = parseInt(String(rawArrows).replace(/[^0-9]/g, ""), 10) || 0;

    const notes = (row[notesCol] || "").trim();
    const color = ETAPA_COLORS[idx % ETAPA_COLORS.length].color;

    parsedStages.push({
      id: `etapa-imp-${Date.now()}-${idx + 1}`,
      name: rawName || `${defaultCycleName} (${startDate})`,
      startDate,
      endDate,
      weeklySessionGoal: sessions > 0 ? Math.min(7, sessions) : 0,
      weeklyArrowGoal: Math.max(0, arrows),
      notes,
      color
    });

    currentEstimatedStartDate = new Date(new Date(endDate + "T12:00:00").getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
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
      error: "No se pudieron identificar filas válidas en el documento."
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
    totalVolumeGoal,
    stages: parsedStages,
    dailyEntries: [],
    headers: headerRow.length > 0 ? headerRow : undefined,
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
    `${dayStr(2)},Descanso,0,"",""`,
    `${dayStr(3)},Control Oficial WA 720,144,"Tiempo oficial 240s, Enfoque en el clic","Anotar las 2 rondas completas en la app"`,
    `${dayStr(4)},Simulacro de Duelos,96,"Respiración bajo presión, Primera flecha fuerte","Disparar sets de 3 flechas en 20 segundos por flecha"`
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
