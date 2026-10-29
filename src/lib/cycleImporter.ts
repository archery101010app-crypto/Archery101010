import * as XLSX from "xlsx";
import { Macrocycle, MacrocyclePhase, ETAPA_COLORS } from "@/lib/db/macrocycleTypes";

export interface ParsedDailyEntry {
  date: string; // YYYY-MM-DD
  title: string;
  targetArrows: number;
  focusPoints: string[];
  notes: string;
  dailyItems: string[];
  customFields?: Array<{ label: string; value: string }>;
  type: "training" | "competition" | "meeting" | "other";
  isRestDay: boolean;
  stageName?: string;
}

export interface ParseSpreadsheetOptions {
  referenceYear?: number;
  referenceMonth?: number; // 1..12
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

const DAY_NAMES_REGEX = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|lun|mar|mi[eé]|jue|vie|s[aá]b|dom|mon|tue|wed|thu|fri|sat|sun|d[ií]a|day|fecha)\b[\s,\.\-:#°º]*/i;

/**
 * Checks if a cell represents a plain day-of-month number (1..31), optionally prefixed by a weekday name (e.g. "15", "Lunes 15", "Día 15", "15.")
 */
export function extractDayOfMonthNumber(raw?: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(DAY_NAMES_REGEX, "")
    .replace(/^(d[ií]a|day)\s*/i, "")
    .replace(/[\.\-º°#]+$/, "")
    .trim();
  if (/^\d{1,2}$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    if (n >= 1 && n <= 31) return n;
  }
  return null;
}

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

  // Plain day of month number (1..31) e.g. "28" or "Lunes 28" or "Día 28"
  const dayNum = extractDayOfMonthNumber(raw);
  if (dayNum !== null) {
    return `${refY}-${String(refM).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
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
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames || [];

  const getSheetTsv = (sheetName: string): string => {
    const ws = workbook.Sheets[sheetName];
    if (!ws) return "";

    // Use raw: true so Date objects stay real Date instances (avoids US M/D/YY locale ambiguity)
    const rawMatrix = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1,
      defval: "",
      raw: true
    });

    const formattedRows = rawMatrix
      .map((row) => {
        if (!Array.isArray(row)) return "";
        return row
          .map((cell) => {
            if (cell === null || cell === undefined) return "";
            if (cell instanceof Date && !isNaN(cell.getTime())) {
              // Add 12 hours before reading UTC date so UTC-6 timezone never shifts a date back 1 day
              const safeUtc = new Date(cell.getTime() + 12 * 3600 * 1000);
              const y = safeUtc.getUTCFullYear();
              const m = String(safeUtc.getUTCMonth() + 1).padStart(2, "0");
              const d = String(safeUtc.getUTCDate()).padStart(2, "0");
              return `${y}-${m}-${d}`;
            }
            // Preserve internal newlines inside a cell with " ||| " so each line becomes a distinct list item
            return String(cell).replace(/\t/g, " ").replace(/\r?\n/g, " ||| ").trim();
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
      currentRow.push(currentCell.replace(/\r?\n/g, " ||| ").trim());
      currentCell = "";
    } else if (!inQuotes && (ch === "\n" || (ch === "\r" && next === "\n"))) {
      if (ch === "\r") i++;
      currentRow.push(currentCell.replace(/\r?\n/g, " ||| ").trim());
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
  currentRow.push(currentCell.replace(/\r?\n/g, " ||| ").trim());
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
 * Splits a cell value into clean individual list items (handling multi-line cells separated by "|||" or "\n")
 */
function splitCellIntoListItems(cellValue: string, headerLabel?: string): string[] {
  if (!cellValue || !cellValue.trim()) return [];
  const rawParts = cellValue
    .split(/\s*\|\|\|\s*|\r?\n/)
    .map((p) => p.replace(/^[•\-\*▪▸]\s*/, "").trim())
    .filter(Boolean);

  if (rawParts.length === 0) return [];

  const isGenericHeader =
    !headerLabel ||
    /^(actividad|actividades|tarea|tareas|entrenamiento|trabajo|ejercicio|ejercicios|rutina|descripci[oó]n|detalle|plan|lista|columna\s*\d+|item\s*\d+)$/i.test(
      headerLabel.trim()
    );

  if (isGenericHeader) {
    return rawParts;
  }

  if (rawParts.length === 1) {
    return [`${headerLabel.trim()}: ${rawParts[0]}`];
  }

  return rawParts.map((p) => `${headerLabel.trim()}: ${p}`);
}

/**
 * Parses raw text from Excel, Google Sheets, or CSV file.
 * Reads dates or day-of-month numbers (1..31) and builds an exact list of items (`dailyItems`) for each date.
 */
export function parseSpreadsheetData(
  rawText: string,
  defaultCycleName = "Plan Importado",
  options?: ParseSpreadsheetOptions
): ParsedCycleResult {
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

  // Try to detect reference month/year if mentioned in a top banner row or plan name (e.g. "NOVIEMBRE 2026" or "Plan Octubre")
  let refYear = options?.referenceYear || new Date().getFullYear();
  let refMonth = options?.referenceMonth || (new Date().getMonth() + 1);

  if (!options?.referenceYear || !options?.referenceMonth) {
    const searchSpace = [defaultCycleName, ...rows.slice(0, 6).map((r) => r.join(" "))].join(" ").toLowerCase();
    if (!options?.referenceYear) {
      const yearMatch = searchSpace.match(/\b(202\d|203\d)\b/);
      if (yearMatch) refYear = parseInt(yearMatch[1], 10);
    }
    if (!options?.referenceMonth) {
      for (const [mWord, mCode] of Object.entries(SPANISH_MONTHS)) {
        if (mWord.length >= 4 && searchSpace.includes(mWord)) {
          refMonth = parseInt(mCode, 10);
          break;
        }
      }
    }
  }

  // Also check if any cell in the sheet has a full YYYY-MM-DD or DD/MM/YYYY date to anchor refYear & refMonth automatically
  if (!options?.referenceYear || !options?.referenceMonth) {
    outerDateScan: for (const r of rows.slice(0, 20)) {
      for (const c of r) {
        if (isValidDateCell(c)) {
          const norm = normalizeDateString(c, "", refYear, refMonth);
          if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) {
            const [yStr, mStr] = norm.split("-");
            if (!options?.referenceYear) refYear = parseInt(yStr, 10);
            if (!options?.referenceMonth) refMonth = parseInt(mStr, 10);
            break outerDateScan;
          }
        }
      }
    }
  }

  // ============================================================================
  // CHECK FOR CALENDAR GRID FORMAT (7-column or multi-column monthly calendar)
  // Where rows contain 3+ day numbers (1..31) across columns and rows below have the tasks
  // ============================================================================
  const dayNumberRowIndices: number[] = [];
  rows.forEach((row, rIdx) => {
    const dayCellsInRow = row.filter((c) => {
      const dNum = extractDayOfMonthNumber(c);
      return dNum !== null || isValidDateCell(c);
    });
    const pureDayNums = row.filter((c) => extractDayOfMonthNumber(c) !== null);
    if (pureDayNums.length >= 3 || (dayCellsInRow.length >= 4 && row.length >= 5)) {
      dayNumberRowIndices.push(rIdx);
    }
  });

  if (dayNumberRowIndices.length >= 2) {
    const gridDailyMap = new Map<string, ParsedDailyEntry>();

    for (let idx = 0; idx < dayNumberRowIndices.length; idx++) {
      const dayRowIdx = dayNumberRowIndices[idx];
      const nextDayRowIdx = idx + 1 < dayNumberRowIndices.length ? dayNumberRowIndices[idx + 1] : rows.length;
      const dayRow = rows[dayRowIdx];

      for (let col = 0; col < dayRow.length; col++) {
        const rawDayCell = (dayRow[col] || "").trim();
        if (!rawDayCell) continue;

        const dNum = extractDayOfMonthNumber(rawDayCell);
        const isFullDate = isValidDateCell(rawDayCell);
        if (dNum === null && !isFullDate) continue;

        const date = normalizeDateString(rawDayCell, "", refYear, refMonth);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        // Collect any text written in the same cell after the day number (if multi-line) + all cells below in this column
        const itemsForDay: string[] = [];
        const sameCellParts = rawDayCell.split(/\s*\|\|\|\s*|\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (sameCellParts.length > 1) {
          sameCellParts.slice(1).forEach((p) => itemsForDay.push(p));
        }

        for (let subR = dayRowIdx + 1; subR < nextDayRowIdx; subR++) {
          const cellVal = (rows[subR]?.[col] || "").trim();
          if (!cellVal) continue;
          // Ignore weekday header rows (e.g. Lunes, Martes...)
          if (/^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|lun|mar|mi[eé]|jue|vie|s[aá]b|dom)$/i.test(cellVal)) {
            continue;
          }
          const subItems = splitCellIntoListItems(cellVal);
          subItems.forEach((si) => {
            if (!itemsForDay.includes(si)) itemsForDay.push(si);
          });
        }

        if (itemsForDay.length === 0) continue;

        const joinedAll = itemsForDay.join(" · ");
        let targetArrows = 0;
        const arrowMatches = joinedAll.match(/\b(\d{1,4})\s*(?:flechas|flecha|fl\.?|tiros|arrows)\b/i);
        if (arrowMatches) {
          targetArrows = parseInt(arrowMatches[1], 10) || 0;
        }

        const lowerAll = joinedAll.toLowerCase();
        const isRestDay =
          (lowerAll === "descanso" || lowerAll.includes("descanso") || lowerAll === "libre" || lowerAll === "rest") &&
          targetArrows === 0;

        gridDailyMap.set(date, {
          date,
          title: itemsForDay[0],
          targetArrows,
          focusPoints: itemsForDay,
          notes: itemsForDay.slice(1).join(" · "),
          dailyItems: itemsForDay,
          customFields: itemsForDay.map((item, i) => ({
            label: `Tarea ${i + 1}`,
            value: item
          })),
          type: isRestDay ? "other" : lowerAll.includes("torneo") || lowerAll.includes("competencia") ? "competition" : "training",
          isRestDay
        });
      }
    }

    const gridEntries = Array.from(gridDailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    if (gridEntries.length > 0) {
      const startDate = gridEntries[0].date;
      const endDate = gridEntries[gridEntries.length - 1].date;
      const totalVolumeGoal = gridEntries.reduce((sum, d) => sum + d.targetArrows, 0);

      return {
        success: true,
        mode: "daily",
        planName: defaultCycleName,
        startDate,
        endDate,
        totalVolumeGoal,
        stages: [
          {
            id: `etapa-grid-${startDate.slice(0, 7)}`,
            name: defaultCycleName,
            startDate,
            endDate,
            weeklySessionGoal: 5,
            weeklyArrowGoal: Math.round(totalVolumeGoal / 4),
            notes: "",
            color: ETAPA_COLORS[0].color
          }
        ],
        dailyEntries: gridEntries,
        warnings
      };
    }
  }

  // Find the first row that looks like either a header row or a data row with a date/day number
  let headerRowIdx = -1;
  let firstDataRowIdx = 0;

  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r];
    const nonEmptyCount = row.filter((c) => c.trim().length > 0).length;
    if (nonEmptyCount === 0) continue;

    const classifications = row.map(classifyHeader);
    const recognizedHeaders = classifications.filter((c) => c !== "unknown").length;
    const hasDateCellInRow = row.some((c) => isValidDateCell(c) || extractDayOfMonthNumber(c) !== null);

    if (recognizedHeaders >= 1 && !row.some((c) => isValidDateCell(c))) {
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

  // Count how many rows have 2 valid full dates vs 1 valid date
  let rowsWithTwoDates = 0;
  let rowsWithOneDate = 0;
  for (const r of dataRows.slice(0, 15)) {
    const dateCols = r.filter((c) => isValidDateCell(c)).length;
    if (dateCols >= 2) rowsWithTwoDates++;
    else if (dateCols === 1) rowsWithOneDate++;
  }

  const isStagesMode = hasStartAndEndHeaders || (rowsWithTwoDates > rowsWithOneDate && rowsWithTwoDates >= 2);

  // ============================================================================
  // MODE 1: DAY-BY-DAY ("daily") LITERAL IMPORT (Default & Most Common)
  // ============================================================================
  if (!isStagesMode) {
    // Identify which column is the Date / Day Number column
    let dateCol = headerClasses.indexOf("date");
    if (dateCol === -1) {
      const maxCols = Math.max(...dataRows.map((r) => r.length), 1);
      let bestCol = 0;
      let bestScore = -1;
      for (let c = 0; c < maxCols; c++) {
        let score = 0;
        for (const r of dataRows) {
          if (isValidDateCell(r[c])) score += 4;
          else if (extractDayOfMonthNumber(r[c]) !== null) score += 2;
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

    const maxCols = Math.max(...dataRows.map((r) => r.length), headerRow.length, 1);
    if (arrowsCol === -1 && maxCols >= 3) {
      for (let c = 0; c < maxCols; c++) {
        if (c === dateCol || c === titleCol || c === focusCol || c === notesCol) continue;
        const hText = (headerRow[c] || "").toLowerCase();
        if (hText && !hText.includes("flecha") && !hText.includes("volumen") && !hText.includes("tiro") && !hText.includes("cant") && !hText.includes("meta")) {
          continue;
        }
        const nonEmptyVals = dataRows.map((r) => (r[c] || "").trim()).filter(Boolean);
        if (nonEmptyVals.length > 0 && nonEmptyVals.every((v) => /^\d+(\s*(fl|flechas|tiros))?$/i.test(v))) {
          arrowsCol = c;
          break;
        }
      }
    }

    if (titleCol === -1) {
      for (let c = 0; c < maxCols; c++) {
        if (c !== dateCol && c !== arrowsCol) {
          titleCol = c;
          break;
        }
      }
    }

    const dailyMap = new Map<string, ParsedDailyEntry>();
    let lastValidDate: string | null = null;

    dataRows.forEach((row, rowIdx) => {
      if (row.every((c) => !c || !c.trim())) return;

      let activeDateCol = dateCol;
      let rawDateCell = (row[activeDateCol] || "").trim();

      // Skip repeated header rows inside the sheet
      if (classifyHeader(rawDateCell) === "date" && !isValidDateCell(rawDateCell) && extractDayOfMonthNumber(rawDateCell) === null) {
        return;
      }

      const hasExplicitDateInCol = isValidDateCell(rawDateCell) || extractDayOfMonthNumber(rawDateCell) !== null;

      if (!hasExplicitDateInCol) {
        // Check if another cell in the first 2 columns has a date (in case of a leading weekday column like "Lunes" | "01/11/2026")
        const altIdx = row.findIndex((c, idx) => idx <= 1 && (isValidDateCell(c) || extractDayOfMonthNumber(c) !== null));
        if (altIdx !== -1) {
          activeDateCol = altIdx;
          rawDateCell = (row[activeDateCol] || "").trim();
        }
      }

      let date: string;
      if (rawDateCell && (isValidDateCell(rawDateCell) || extractDayOfMonthNumber(rawDateCell) !== null)) {
        const fallback = `${refYear}-${String(refMonth).padStart(2, "0")}-${String(Math.min(31, rowIdx + 1)).padStart(2, "0")}`;
        date = normalizeDateString(rawDateCell, fallback, refYear, refMonth);
        lastValidDate = date;
      } else if (!rawDateCell && lastValidDate) {
        // Continuation row! The user left the date blank to add more items to the same date's list
        date = lastValidDate;
      } else {
        // Skip section headers or rows without any date
        return;
      }

      // Extract arrows ONLY if explicitly present in the sheet
      let targetArrows = 0;
      if (arrowsCol !== -1 && row[arrowsCol] !== undefined) {
        const rawArrowsStr = String(row[arrowsCol]).trim();
        const numMatch = rawArrowsStr.match(/\d+/);
        if (numMatch) {
          targetArrows = parseInt(numMatch[0], 10) || 0;
        }
      }

      const rawTitle = titleCol !== -1 && row[titleCol] ? row[titleCol].replace(/\s*\|\|\|\s*/g, " · ").trim() : "";
      const rawFocus = focusCol !== -1 && row[focusCol] ? row[focusCol].replace(/\s*\|\|\|\s*/g, " · ").trim() : "";
      const rawNotes = notesCol !== -1 && row[notesCol] ? row[notesCol].replace(/\s*\|\|\|\s*/g, " · ").trim() : "";

      // Build the structured list of items (`rowItems`) and `customFields` for this row
      const rowItems: string[] = [];
      const customFields: Array<{ label: string; value: string }> = [];
      const extraTextParts: string[] = [];

      for (let c = 0; c < row.length; c++) {
        if (c === activeDateCol) continue;
        const rawCellVal = (row[c] || "").trim();
        if (!rawCellVal) continue;

        // Skip if this column is just a standalone weekday name next to the date column (e.g. "Lunes")
        if (c <= 1 && /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|lun|mar|mi[eé]|jue|vie|s[aá]b|dom)$/i.test(rawCellVal)) {
          continue;
        }

        const colHeader = (headerRow[c] || "").trim();
        const cleanDisplayVal = rawCellVal.replace(/\s*\|\|\|\s*/g, " · ");

        if (colHeader) {
          customFields.push({ label: colHeader, value: cleanDisplayVal });
        }

        // Convert cell into clean list item(s) for the day's checklist
        if (c === arrowsCol) {
          if (targetArrows > 0) {
            rowItems.push(`Flechas: ${targetArrows} flechas`);
          } else {
            rowItems.push(...splitCellIntoListItems(rawCellVal, colHeader || "Flechas"));
          }
        } else {
          const splitItems = splitCellIntoListItems(rawCellVal, colHeader);
          splitItems.forEach((item) => {
            if (!rowItems.includes(item)) rowItems.push(item);
          });
        }

        if (c !== titleCol && c !== arrowsCol && c !== focusCol && c !== notesCol) {
          if (colHeader) {
            extraTextParts.push(`${colHeader}: ${cleanDisplayVal}`);
          } else {
            extraTextParts.push(cleanDisplayVal);
          }
        }
      }

      if (targetArrows === 0) {
        const joinedRowText = row.filter((_, idx) => idx !== activeDateCol).join(" ");
        const inlineArrowsMatch = joinedRowText.match(/\b(\d{1,4})\s*(?:flechas|flecha|fl\.?|tiros|arrows)\b/i);
        if (inlineArrowsMatch) {
          targetArrows = parseInt(inlineArrowsMatch[1], 10) || 0;
        }
      }

      let literalTitle = rawTitle;
      if (!literalTitle && rowItems.length > 0) {
        literalTitle = rowItems[0];
      }
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

      if (!literalTitle && targetArrows === 0 && rowItems.length === 0) {
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
        const existing = dailyMap.get(date)!;
        rowItems.forEach((item) => {
          if (!existing.dailyItems.includes(item)) {
            existing.dailyItems.push(item);
          }
        });
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
          dailyItems: rowItems.length > 0 ? rowItems : [literalTitle],
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
 * Generates and downloads a formatted .xlsx Excel workbook with two ready-to-use sheets:
 * 1. "Lista por Fecha" (Every day of the selected month with columns for multiple tasks/items per day)
 * 2. "Calendario Mensual" (7-column Lunes-Domingo grid where tasks are written under each day number)
 */
export function downloadFormattedExcelTemplate(year?: number, month?: number): void {
  const y = year || new Date().getFullYear();
  const m = month || (new Date().getMonth() + 1); // 1..12
  const daysInMonth = new Date(y, m, 0).getDate();
  const weekdayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const mName = monthNames[m - 1] || "Mes";

  // Sheet 1: Clean Row-by-Row Date List (Recommended)
  const listAoA: string[][] = [
    [
      "Fecha",
      "Día",
      "Actividad 1 (Tiro / Distancia)",
      "Actividad 2 (Técnica / Liga)",
      "Actividad 3 (Físico / Gimnasio)",
      "Flechas",
      "Notas / Indicaciones"
    ]
  ];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m - 1, d);
    const dow = dateObj.getDay();
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayLabel = `${weekdayNames[dow]} ${d}`;

    if (d === 1) {
      listAoA.push([
        dateStr,
        dayLabel,
        "Volumen Técnico 70m (series de 6 flechas)",
        "15 min calentamiento con banda elástica",
        "Core y estabilidad de hombros (20 min)",
        "120",
        "Mantener ritmo constante de disparo"
      ]);
    } else if (d === 2) {
      listAoA.push([
        dateStr,
        dayLabel,
        "Control WA 720 (2 rondas de 36 flechas)",
        "Revisión de postura y suelta",
        "Estiramiento completo al finalizar",
        "72",
        "Registrar puntuación en Archery 101010"
      ]);
    } else if (dow === 0) {
      listAoA.push([dateStr, dayLabel, "Descanso", "", "", "0", "Recuperación activa"]);
    } else {
      listAoA.push([dateStr, dayLabel, "", "", "", "", ""]);
    }
  }

  const wb = XLSX.utils.book_new();
  const wsList = XLSX.utils.aoa_to_sheet(listAoA);
  wsList["!cols"] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 38 },
    { wch: 34 },
    { wch: 32 },
    { wch: 10 },
    { wch: 34 }
  ];
  XLSX.utils.book_append_sheet(wb, wsList, `Lista ${mName}`);

  // Sheet 2: Visual 7-Column Monthly Calendar Grid (Lunes..Domingo)
  const gridAoA: string[][] = [
    [`PLAN MENSUAL - ${mName.toUpperCase()} ${y}`, "", "", "", "", "", ""],
    ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
  ];

  let currentDay = 1;
  while (currentDay <= daysInMonth) {
    const numberRow = ["", "", "", "", "", "", ""];
    const taskRow1 = ["", "", "", "", "", "", ""];
    const taskRow2 = ["", "", "", "", "", "", ""];
    const taskRow3 = ["", "", "", "", "", "", ""];

    for (let col = 0; col < 7 && currentDay <= daysInMonth; col++) {
      const dateObj = new Date(y, m - 1, currentDay);
      // Convert JS getDay (0=Sun..6=Sat) to Monday-first (0=Mon..6=Sun)
      const monFirstCol = (dateObj.getDay() + 6) % 7;
      if (monFirstCol === col) {
        numberRow[col] = String(currentDay);
        if (currentDay === 1) {
          taskRow1[col] = "Calentamiento con liga 15 min";
          taskRow2[col] = "120 flechas a 70m";
          taskRow3[col] = "Físico: Core y hombro";
        } else if (monFirstCol === 6) {
          taskRow1[col] = "Descanso";
        }
        currentDay++;
      }
    }

    gridAoA.push(numberRow, taskRow1, taskRow2, taskRow3);
  }

  const wsGrid = XLSX.utils.aoa_to_sheet(gridAoA);
  wsGrid["!cols"] = Array.from({ length: 7 }, () => ({ wch: 26 }));
  XLSX.utils.book_append_sheet(wb, wsGrid, `Calendario ${mName}`);

  XLSX.writeFile(wb, `Formato_Plan_${mName}_${y}_Archery101010.xlsx`);
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
