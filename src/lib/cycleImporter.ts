import { type Macrocycle, type MacrocyclePhase, ETAPA_COLORS } from "./db/macrocycleTypes.ts";
import { downloadOrShareFile } from "./fileDownload.ts";
import { getLocalISODate } from "./i18n/regionalUtils.ts";

let xlsxModulePromise: Promise<typeof import("xlsx")> | null = null;

async function loadXlsx() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("xlsx");
  }
  return xlsxModulePromise;
}

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
  preferMonthFirst?: boolean;
  lang?: string;
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
  // 01 - ES / EN / PT / FR / DE / IT / KO / JA
  ene: "01", enero: "01",
  jan: "01", january: "01",
  janeiro: "01",
  janv: "01", janvier: "01",
  jän: "01", jaen: "01", januar: "01",
  gen: "01", gennaio: "01",
  "1월": "01", "01월": "01", "일월": "01",
  "1月": "01", "01月": "01", "一月": "01",

  // 02
  feb: "02", febrero: "02",
  february: "02",
  fev: "02", fevereiro: "02",
  févr: "02", fevr: "02", février: "02", fevrier: "02",
  februar: "02",
  febbraio: "02",
  "2월": "02", "02월": "02", "이월": "02",
  "2月": "02", "02月": "02", "二月": "02",

  // 03
  mar: "03", marzo: "03",
  march: "03",
  março: "03", marco: "03",
  mars: "03",
  mär: "03", märz: "03", maerz: "03", marz: "03",
  "3월": "03", "03월": "03", "삼월": "03",
  "3月": "03", "03月": "03", "三月": "03",

  // 04
  abr: "04", abril: "04",
  apr: "04", april: "04",
  avr: "04", avril: "04",
  aprile: "04",
  "4월": "04", "04월": "04", "사월": "04",
  "4月": "04", "04月": "04", "四月": "04",

  // 05
  may: "05", mayo: "05",
  mai: "05", maio: "05",
  mag: "05", maggio: "05",
  "5월": "05", "05월": "05", "오월": "05",
  "5月": "05", "05月": "05", "五月": "05",

  // 06
  jun: "06", junio: "06",
  june: "06",
  junho: "06",
  juin: "06",
  juni: "06",
  giu: "06", giugno: "06",
  "6월": "06", "06월": "06", "유월": "06",
  "6月": "06", "06月": "06", "六月": "06",

  // 07
  jul: "07", julio: "07",
  july: "07",
  julho: "07",
  juil: "07", juillet: "07",
  juli: "07",
  lug: "07", luglio: "07",
  "7월": "07", "07월": "07", "칠월": "07",
  "7月": "07", "07月": "07", "七月": "07",

  // 08
  ago: "08", agosto: "08",
  aug: "08", august: "08",
  août: "08", aout: "08",
  "8월": "08", "08월": "08", "팔월": "08",
  "8月": "08", "08月": "08", "八月": "08",

  // 09
  sep: "09", sept: "09", septiembre: "09",
  september: "09",
  set: "09", setembro: "09",
  septembre: "09",
  settembre: "09",
  "9월": "09", "09월": "09", "구월": "09",
  "9月": "09", "09月": "09", "九月": "09",

  // 10
  oct: "10", octubre: "10",
  october: "10",
  out: "10", outubro: "10",
  octobre: "10",
  okt: "10", oktober: "10",
  ott: "10", ottobre: "10",
  "10월": "10", "시월": "10",
  "10月": "10", "十月": "10",

  // 11
  nov: "11", noviembre: "11",
  november: "11",
  novembro: "11",
  novembre: "11",
  "11월": "11", "십일월": "11",
  "11月": "11", "十一月": "11",

  // 12
  dic: "12", diciembre: "12",
  dec: "12", december: "12",
  dez: "12", dezembro: "12",
  déc: "12", décembre: "12", decembre: "12",
  dezember: "12",
  dicembre: "12",
  "12월": "12", "십이월": "12",
  "12月": "12", "十二月": "12"
};

export const MULTILINGUAL_MONTHS = SPANISH_MONTHS;

function resolveMonthCode(rawWord?: string): string | undefined {
  if (!rawWord) return undefined;
  const clean = rawWord.trim().toLowerCase().replace(/\.$/, "");
  return (
    SPANISH_MONTHS[clean] ||
    (clean.length >= 4 ? SPANISH_MONTHS[clean.slice(0, 4)] : undefined) ||
    (clean.length >= 3 ? SPANISH_MONTHS[clean.slice(0, 3)] : undefined)
  );
}

const LATIN_WEEKDAY_PATTERN =
  "lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|" +
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
  "segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|" +
  "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|" +
  "montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|" +
  "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|" +
  "lun|mar|mi[eé]|jue|vie|s[aá]b|dom|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|" +
  "seg|ter|qua|qui|sex|mer|jeu|ven|sam|dim|mo|di|mi|do|fr|sa|so|gio|sab";

const DAY_NAMES_REGEX = new RegExp(
  `^(?:` +
    `(?:${LATIN_WEEKDAY_PATTERN}|d[ií]a|day|fecha|data|datum|date|jour|tag|giorno)(?=$|[\\s,\\.\\-:#°º()\\/])|` +
    `(?:월요일|화요일|수요일|목요일|금요일|토요일|일요일|月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日|月曜|火曜|水曜|木曜|金曜|土曜|日曜)(?=$|[\\s,\\.\\-:#°º()\\/0-9])|` +
    `(?:월|화|수|목|금|토|일|月|火|水|木|金|土|日)(?=[\\s,\\.\\-:#°º()\\/]+)` +
  `)[\\s,\\.\\-:#°º]*`,
  "i"
);

const STANDALONE_WEEKDAY_REGEX = new RegExp(
  `^(?:${LATIN_WEEKDAY_PATTERN}|월요일|화요일|수요일|목요일|금요일|토요일|일요일|월|화|수|목|금|토|일|月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日|月曜|火曜|水曜|木曜|金曜|土曜|日曜|月|火|水|木|金|土|日)$`,
  "i"
);

const TRAILING_CJK_WEEKDAY_REGEX =
  /\s*[\(（](?:월요일|화요일|수요일|목요일|금요일|토요일|일요일|월|화|수|목|금|토|일|月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日|月曜|火曜|水曜|木曜|金曜|土曜|日曜|月|火|水|木|金|土|日|[a-zà-ÿ]{2,10})[\)）]\s*$/i;

function stripWeekdayTokens(raw: string): string {
  return raw
    .trim()
    .replace(DAY_NAMES_REGEX, "")
    .replace(TRAILING_CJK_WEEKDAY_REGEX, "")
    .trim();
}

/**
 * Checks if a cell represents a plain day-of-month number (1..31), optionally prefixed by a weekday name (e.g. "15", "Lunes 15", "Día 15", "15.", "15일", "15日")
 */
export function extractDayOfMonthNumber(raw?: string): number | null {
  if (!raw) return null;
  const stripped = stripWeekdayTokens(raw);
  if (/[월月]/.test(stripped)) return null;
  const cleaned = stripped
    .replace(/^(?:d[ií]a|day|jour|tag|giorno)\s*/i, "")
    .replace(/(?:일|日)$/, "")
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
  const cleaned = stripWeekdayTokens(raw).toLowerCase();
  if (!cleaned) return false;

  // Excel serial date (40000..60000)
  if (/^\d{5}(?:\.\d+)?$/.test(cleaned)) {
    const num = parseFloat(cleaned);
    if (num >= 40000 && num <= 60000) return true;
  }

  // Korean / Japanese date e.g. "2026년 11월 16일", "11월 16일", "2026年11月16日", "11月16日"
  const cjkMatch = cleaned.match(/^(?:(\d{2,4})\s*[년年]\s*)?(\d{1,2})\s*[월月]\s*(\d{1,2})\s*[일日]?$/);
  if (cjkMatch) {
    const m = parseInt(cjkMatch[2], 10);
    const d = parseInt(cjkMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/.test(cleaned)) return true;

  // DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY or DD/MM/YY
  const fullSlash = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (fullSlash) {
    const a = parseInt(fullSlash[1], 10);
    const b = parseInt(fullSlash[2], 10);
    if ((a >= 1 && a <= 31 && b >= 1 && b <= 12) || (a >= 1 && a <= 12 && b >= 1 && b <= 31)) {
      return true;
    }
  }

  // Short DD/MM, MM/DD or DD-MM (without year, e.g. "28/10", "10/28", "05-11")
  const dmMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dmMatch) {
    const d = parseInt(dmMatch[1], 10);
    const m = parseInt(dmMatch[2], 10);
    if ((d >= 1 && d <= 31 && m >= 1 && m <= 12) || (m >= 1 && m <= 31 && d >= 1 && d <= 12)) {
      return true;
    }
  }

  // DD de mes de YYYY or DD mes YYYY or DD-mes (ES/EN/PT/FR/DE/IT, e.g., "15 oct 2026", "15. märz 2026", "28 de outubro")
  const textMonthMatch = cleaned.match(
    /^(\d{1,2})\.?(?:\s*(?:de|do|da|of)\s*|\s*d'\s*|[\/\-\.\s]+)([a-zà-ÿçœ\.]{3,14})(?:(?:\s*(?:de|do|da|of)\s*|[\/\-\.,\s]+)(\d{2,4}))?$/
  );
  if (textMonthMatch) {
    if (resolveMonthCode(textMonthMatch[2])) return true;
  }

  // Month DD, YYYY or Month DD (e.g. "Oct 28", "Octubre 28, 2026", "Fevereiro 14, 2026")
  const monthFirstMatch = cleaned.match(/^([a-zà-ÿçœ\.]{3,14})[\s\-\.]+(\d{1,2})\.?(?:[\s,\-\.]+(\d{2,4}))?$/);
  if (monthFirstMatch) {
    if (resolveMonthCode(monthFirstMatch[1])) return true;
  }

  // Embedded full date inside text (e.g. "Lunes 26/10/2026" or "Monday 10/26/2026")
  if (/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/.test(cleaned)) return true;
  if (/\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/.test(cleaned)) return true;

  return false;
}

/**
 * Normalizes dates from any common format into YYYY-MM-DD
 */
export function normalizeDateString(
  raw: string,
  fallbackDate: string,
  referenceYear?: number,
  referenceMonth?: number,
  preferMonthFirst = false
): string {
  if (!raw) return fallbackDate;
  const nowLocal = new Date();
  const refY = referenceYear || nowLocal.getFullYear();
  const refM = referenceMonth || (nowLocal.getMonth() + 1);

  const trimmed = stripWeekdayTokens(raw).toLowerCase();
  if (!trimmed) return fallbackDate;

  // Excel serial number (keep UTC math for timezone-less Excel serial integers)
  if (/^\d{5}(?:\.\d+)?$/.test(trimmed)) {
    const serialDate = excelSerialToYMD(parseFloat(trimmed));
    if (serialDate) return serialDate;
  }

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Korean / Japanese date e.g. "2026년 11월 16일", "11월 16일", "2026年11月16日", "11月16日"
  const cjkMatch = trimmed.match(/(?:(\d{2,4})\s*[년年]\s*)?(\d{1,2})\s*[월月]\s*(\d{1,2})\s*[일日]?/);
  if (cjkMatch) {
    const [, rawYear, mStr, dStr] = cjkMatch;
    let y = rawYear || String(refY);
    if (y.length === 2) y = `20${y}`;
    const mNum = parseInt(mStr, 10);
    const dNum = parseInt(dStr, 10);
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return `${y}-${String(mNum).padStart(2, "0")}-${String(dNum).padStart(2, "0")}`;
    }
  }

  // Embedded YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = trimmed.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // A/B/YYYY (handles both DD/MM/YYYY and US MM/DD/YYYY intelligently)
  const dmyMatch = trimmed.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmyMatch) {
    const [, aStr, bStr, rawY] = dmyMatch;
    const y = rawY.length === 2 ? `20${rawY}` : rawY;
    const aNum = parseInt(aStr, 10);
    const bNum = parseInt(bStr, 10);
    if (aNum <= 12 && bNum > 12) {
      // Unambiguous US MM/DD/YYYY (A <= 12 && B > 12)
      return `${y}-${aStr.padStart(2, "0")}-${bStr.padStart(2, "0")}`;
    }
    if (aNum > 12 && bNum <= 12) {
      // Unambiguous DD/MM/YYYY (A > 12 && B <= 12)
      return `${y}-${bStr.padStart(2, "0")}-${aStr.padStart(2, "0")}`;
    }
    if (preferMonthFirst && aNum >= 1 && aNum <= 12 && bNum >= 1 && bNum <= 31) {
      return `${y}-${aStr.padStart(2, "0")}-${bStr.padStart(2, "0")}`;
    }
    return `${y}-${bStr.padStart(2, "0")}-${aStr.padStart(2, "0")}`;
  }

  // DD mes YYYY or DD-mes (ES/EN/PT/FR/DE/IT)
  const textMonthMatch = trimmed.match(
    /(\d{1,2})\.?(?:\s*(?:de|do|da|of)\s*|\s*d'\s*|[\/\-\.\s]+)([a-zà-ÿçœ\.]{3,14})(?:(?:\s*(?:de|do|da|of)\s*|[\/\-\.,\s]+)(\d{2,4}))?/
  );
  if (textMonthMatch) {
    const [, d, monthWord, rawYear] = textMonthMatch;
    const monthCode = resolveMonthCode(monthWord);
    if (monthCode) {
      let y = rawYear || String(refY);
      if (y.length === 2) y = `20${y}`;
      return `${y}-${monthCode}-${d.padStart(2, "0")}`;
    }
  }

  // Month DD, YYYY (e.g. "Oct 28", "Octubre 28 2026", "Mars 15, 2026")
  const monthFirstMatch = trimmed.match(/^([a-zà-ÿçœ\.]{3,14})[\s\-\.]+(\d{1,2})\.?(?:[\s,\-\.]+(\d{2,4}))?/);
  if (monthFirstMatch) {
    const [, monthWord, d, rawYear] = monthFirstMatch;
    const monthCode = resolveMonthCode(monthWord);
    if (monthCode) {
      let y = rawYear || String(refY);
      if (y.length === 2) y = `20${y}`;
      return `${y}-${monthCode}-${d.padStart(2, "0")}`;
    }
  }

  // Short DD/MM or MM/DD (without year, e.g. "28/10" or "10/28")
  const dmMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dmMatch) {
    const aNum = parseInt(dmMatch[1], 10);
    const bNum = parseInt(dmMatch[2], 10);
    if (aNum <= 12 && bNum > 12 && bNum <= 31) {
      return `${refY}-${String(aNum).padStart(2, "0")}-${String(bNum).padStart(2, "0")}`;
    }
    if (aNum > 12 && aNum <= 31 && bNum >= 1 && bNum <= 12) {
      return `${refY}-${String(bNum).padStart(2, "0")}-${String(aNum).padStart(2, "0")}`;
    }
    if (preferMonthFirst && aNum >= 1 && aNum <= 12 && bNum >= 1 && bNum <= 31) {
      return `${refY}-${String(aNum).padStart(2, "0")}-${String(bNum).padStart(2, "0")}`;
    }
    if (aNum >= 1 && aNum <= 31 && bNum >= 1 && bNum <= 12) {
      return `${refY}-${String(bNum).padStart(2, "0")}-${String(aNum).padStart(2, "0")}`;
    }
  }

  // Plain day of month number (1..31) e.g. "28" or "Lunes 28" or "Día 28" or "28일" or "28日"
  const dayNum = extractDayOfMonthNumber(raw);
  if (dayNum !== null) {
    return `${refY}-${String(refM).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
  }

  return fallbackDate;
}

/**
 * Parses a spreadsheet (.xlsx / .xls / .csv) ArrayBuffer using lazy-loaded SheetJS
 * Returns the list of sheet names and a helper to extract TSV text from any sheet.
 */
export async function parseExcelWorkbookBuffer(buffer: ArrayBuffer): Promise<{
  sheetNames: string[];
  getSheetTsv: (sheetName: string) => string;
}> {
  const XLSX = await loadXlsx();
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
 * Extracts a cloud spreadsheet ID from a shared URL and fetches its CSV content directly.
 * Tries /export?format=csv first (preserves mixed numeric/text calendar grid cells) with /gviz/tq as fallback.
 */
export async function fetchGoogleSheetCsv(
  sheetUrl: string,
  lang = "es"
): Promise<{ ok: boolean; csv?: string; error?: string }> {
  const isEs = lang === "es";
  try {
    const trimmed = sheetUrl.trim();
    const gidMatch = trimmed.match(/[#&?]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : "";

    const isValidSheetCsv = (csvText: string): boolean => {
      const csvLower = (csvText || "").toLowerCase();
      return Boolean(
        csvText &&
        csvText.trim().length > 0 &&
        !csvText.trim().startsWith("<!DOCTYPE html>") &&
        !csvText.trim().startsWith("<html") &&
        !csvLower.includes("offline mode active") &&
        !csvLower.includes("connect to the internet") &&
        !csvLower.includes("accounts.google.com/servicelogin")
      );
    };

    // Support published links (/spreadsheets/d/e/2PACX-.../pub or /pubhtml)
    if (trimmed.includes("/spreadsheets/d/e/")) {
      const pubBase = trimmed.split(/[?#]/)[0].replace(/\/pubhtml$/, "/pub");
      const pubUrl = gid
        ? `${pubBase}?gid=${gid}&single=true&output=csv`
        : `${pubBase}?output=csv`;
      const resp = await fetch(pubUrl);
      if (resp.ok) {
        const text = await resp.text();
        if (isValidSheetCsv(text)) {
          return { ok: true, csv: text };
        }
      }
    }

    const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) {
      return {
        ok: false,
        error: isEs
          ? "El enlace no parece ser una hoja de cálculo en la nube válida."
          : "The link does not appear to be a valid cloud spreadsheet URL."
      };
    }

    const sheetId = idMatch[1];
    const gidParam = gid ? `&gid=${gid}` : "";

    // Try /export?format=csv FIRST so mixed numeric/text cells in 7-column calendar grids aren't nulled out by gviz/tq
    const candidateUrls = [
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gidParam}`
    ];

    for (const url of candidateUrls) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const csvText = await response.text();
        if (isValidSheetCsv(csvText)) {
          return { ok: true, csv: csvText };
        }
      } catch {
        // try next endpoint
      }
    }

    return {
      ok: false,
      error: isEs
        ? "No se pudo leer la hoja. En tu documento en la nube toca 'Compartir' y cámbialo a 'Cualquier persona con el enlace (Lector)', o copia y pega las celdas directamente."
        : "Could not read the spreadsheet. Set cloud link sharing to 'Anyone with the link (Viewer)', or copy and paste the cells directly."
    };
  } catch {
    return {
      ok: false,
      error: isEs
        ? "No se pudo conectar con la hoja en la nube. Puedes copiar las celdas y pegarlas directamente."
        : "Could not connect to the cloud spreadsheet. You can copy the cells and paste them directly."
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
 * Supports ES, EN, PT, FR, DE, IT, KO, JA spreadsheet headers.
 */
function classifyHeader(hRaw: string): "date" | "startDate" | "endDate" | "title" | "arrows" | "focus" | "notes" | "sessions" | "unknown" {
  const h = hRaw.trim().toLowerCase();
  if (!h) return "unknown";

  if (
    /\binicio\b|\binício\b|fecha\s*inicio|data\s*(?:de\s*)?in[ií]cio|\bdesde\b|start\s*date|\bstart\b|\bd[eé]but\b|date\s*de\s*d[eé]but|startdatum|\bbeginn\b|data\s*inizio|\binizio\b|시작일|시작\s*날짜|開始日|開始/.test(
      h
    )
  ) {
    return "startDate";
  }

  if (
    /\bfin\b|\bfim\b|fecha\s*fin|data\s*(?:de\s*)?fim|data\s*final|\btermino\b|\bt[eé]rmino\b|end\s*date|\bhasta\b|\bat[eé]\b|\bend\b|date\s*de\s*fin|enddatum|\bende\b|data\s*fine|\bfine\b|종료일|종료\s*날짜|마감일|終了日|終了/.test(
      h
    )
  ) {
    return "endDate";
  }

  if (
    h === "fecha" ||
    h.includes("fecha") ||
    h === "día" ||
    h === "dia" ||
    h.startsWith("día ") ||
    h.startsWith("dia ") ||
    h === "date" ||
    h === "day" ||
    h === "data" ||
    h === "datum" ||
    h === "tag" ||
    h === "jour" ||
    h === "journée" ||
    h === "giorno" ||
    h === "날짜" ||
    h === "일자" ||
    h === "요일" ||
    h === "日付" ||
    h === "月日" ||
    h === "曜日"
  ) {
    return "date";
  }

  if (
    ((h.includes("sesion") ||
      h.includes("sesión") ||
      h.includes("session") ||
      h.includes("sessão") ||
      h.includes("sessoes") ||
      h.includes("sessões") ||
      h.includes("séance") ||
      h.includes("seance") ||
      h.includes("einheit")) &&
      (h.includes("sem") || h.includes("week") || h.includes("hebdo") || h.includes("woche") || h.includes("sett"))) ||
    /주간\s*세션|주당\s*훈련|훈련\s*횟수|週間セッション|週回数|練習回数/.test(h)
  ) {
    return "sessions";
  }

  if (
    h.includes("flecha") ||
    h.includes("volumen") ||
    h.includes("volume") ||
    h.includes("tiros") ||
    h.includes("arrow") ||
    h.includes("shots") ||
    h.includes("cant") ||
    h.includes("seta") ||
    h.includes("disparo") ||
    h.includes("flèche") ||
    h.includes("fleche") ||
    h.includes("pfeil") ||
    h.includes("umfang") ||
    h.includes("schüss") ||
    h.includes("schuess") ||
    h.includes("frecc") ||
    h.includes("tiri") ||
    h.includes("화살") ||
    h.includes("발수") ||
    h.includes("볼륨") ||
    h.includes("射数") ||
    h.includes("矢数") ||
    h.includes("本数") ||
    h.includes("アロー")
  ) {
    return "arrows";
  }

  if (
    h.includes("actividad") ||
    h.includes("activity") ||
    h.includes("atividade") ||
    h.includes("activité") ||
    h.includes("activite") ||
    h.includes("aktivität") ||
    h.includes("aktivitaet") ||
    h.includes("attività") ||
    h.includes("attivita") ||
    h.includes("tarea") ||
    h.includes("task") ||
    h.includes("tarefa") ||
    h.includes("tâche") ||
    h.includes("tache") ||
    h.includes("aufgabe") ||
    h.includes("compito") ||
    h.includes("entrenamiento") ||
    h.includes("training") ||
    h.includes("workout") ||
    h.includes("treino") ||
    h.includes("treinamento") ||
    h.includes("entraînement") ||
    h.includes("entrainement") ||
    h.includes("allenamento") ||
    h.includes("trabajo") ||
    h.includes("ejercicio") ||
    h.includes("exercise") ||
    h.includes("drill") ||
    h.includes("exercício") ||
    h.includes("exercicio") ||
    h.includes("übung") ||
    h.includes("uebung") ||
    h.includes("esercizio") ||
    h.includes("rutina") ||
    h.includes("routine") ||
    h.includes("rotina") ||
    h.includes("sesión") ||
    h.includes("sesion") ||
    h.includes("session") ||
    h.includes("sessão") ||
    h.includes("séance") ||
    h.includes("seance") ||
    h.includes("einheit") ||
    h.includes("título") ||
    h.includes("titulo") ||
    h.includes("title") ||
    h.includes("titre") ||
    h.includes("titel") ||
    h.includes("titolo") ||
    h.includes("etapa") ||
    h.includes("stage") ||
    h.includes("étape") ||
    h.includes("etape") ||
    h.includes("etappe") ||
    h.includes("tappa") ||
    h.includes("fase") ||
    h.includes("phase") ||
    h.includes("nombre") ||
    h.includes("name") ||
    h.includes("nome") ||
    h === "nom" ||
    h.includes("plan") ||
    h.includes("plano") ||
    h.includes("piano") ||
    /활동|과제|훈련|운동|연습|세션|제목|단계|페이즈|이름|계획|活動|課題|メニュー|練習|トレーニング|セッション|タイトル|段階|フェーズ|ステージ|名前/.test(h)
  ) {
    return "title";
  }

  if (
    h.includes("enfoque") ||
    h.includes("focus") ||
    h.includes("fokus") ||
    h.includes("técnica") ||
    h.includes("tecnica") ||
    h.includes("technique") ||
    h.includes("technik") ||
    h.includes("foco") ||
    h.includes("objetivo") ||
    h.includes("objective") ||
    h.includes("objectif") ||
    h.includes("obiettivo") ||
    h.includes("schwerpunkt") ||
    h === "ziel" ||
    /중점|포커스|기술|목표|핵심|フォーカス|重点|技術|課題点|目標/.test(h)
  ) {
    return "focus";
  }

  if (
    h.includes("nota") ||
    h.includes("note") ||
    h.includes("notiz") ||
    h.includes("remarque") ||
    h.includes("remark") ||
    h.includes("bemerkung") ||
    h.includes("hinweis") ||
    h.includes("indicacion") ||
    h.includes("indicación") ||
    h.includes("observacion") ||
    h.includes("observación") ||
    h.includes("observação") ||
    h.includes("observacao") ||
    h.includes("observation") ||
    h.includes("osservazion") ||
    h.includes("detalle") ||
    h.includes("detalhe") ||
    h.includes("détail") ||
    h.includes("detail") ||
    h.includes("dettagli") ||
    h.includes("comentario") ||
    h.includes("comentário") ||
    h.includes("comment") ||
    h.includes("kommentar") ||
    h.includes("descrip") ||
    h.includes("descriç") ||
    h.includes("descriz") ||
    h.includes("beschreibung") ||
    /메모|비고|노트|참고|설명|코멘트|メモ|備考|ノート|コメント|詳細|説明/.test(h)
  ) {
    return "notes";
  }

  return "unknown";
}

const INLINE_ARROWS_REGEX =
  /(?:^|\b)(\d{1,4})\s*(?:(?:flechas?|fl\.?|tiros?|arrows?|shots?|setas?|fl[eè]ches?|pfeile?|frecce|freccia)\b|(?:화살|발|射数|射|本))/i;

function isRestDayText(lowerText: string): boolean {
  const t = lowerText.trim();
  if (!t) return false;
  return (
    t === "descanso" ||
    t.includes("descanso") ||
    t === "libre" ||
    t.includes("día libre") ||
    t.includes("dia libre") ||
    t.includes("dia livre") ||
    t === "folga" ||
    t.includes("folga") ||
    t === "rest" ||
    t === "rest day" ||
    t === "day off" ||
    t === "off" ||
    t === "repos" ||
    t.includes("jour de repos") ||
    t === "relâche" ||
    t === "relache" ||
    t === "ruhetag" ||
    t.includes("ruhetag") ||
    t === "frei" ||
    t === "riposo" ||
    t.includes("giorno di riposo") ||
    t === "휴식" ||
    t === "휴식일" ||
    t === "휴무" ||
    t.includes("휴식") ||
    t === "休息" ||
    t === "休養" ||
    t === "休養日" ||
    t === "休み" ||
    t === "オフ"
  );
}

function isCompetitionText(lowerText: string): boolean {
  return /torneo|torneio|competencia|competição|compétition|competition|campeonato|clasificatorio|tournament|championship|qualifier|tournoi|wettkampf|turnier|meisterschaft|gara|대회|시합|경기|大会|試合/i.test(
    lowerText
  );
}

function isMeetingText(lowerText: string): boolean {
  return /reuni[oó]n|reunião|réunion|charla|junta|meeting|briefing|besprechung|riunione|회의|미팅|ミーティング|会議/i.test(
    lowerText
  );
}

/**
 * Splits a cell value into clean individual list items (handling multi-line cells separated by "|||" or "\n")
 * Preserves 100% literal text without prepending column header labels or inventing text.
 */
function splitCellIntoListItems(cellValue: string): string[] {
  if (!cellValue || !cellValue.trim()) return [];
  return cellValue
    .split(/\s*\|\|\|\s*|\r?\n/)
    .map((p) => p.replace(/^[•\-\*▪▸]\s*/, "").trim())
    .filter(Boolean);
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
  const todayStr = getLocalISODate();

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

  // Detect whether slash dates in the sheet use US MM/DD/YYYY (when A <= 12 && B > 12 appears and A > 12 never appears)
  let preferMonthFirst = Boolean(options?.preferMonthFirst);
  if (options?.preferMonthFirst === undefined) {
    let usMonthFirstHits = 0;
    let dayFirstHits = 0;
    for (const r of rows.slice(0, 40)) {
      for (const c of r) {
        const m = (c || "").trim().match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
        if (m) {
          const a = parseInt(m[1], 10);
          const b = parseInt(m[2], 10);
          if (a >= 1 && a <= 12 && b > 12 && b <= 31) usMonthFirstHits++;
          else if (a > 12 && a <= 31 && b >= 1 && b <= 12) dayFirstHits++;
        }
      }
    }
    if (usMonthFirstHits > 0 && dayFirstHits === 0) {
      preferMonthFirst = true;
    }
  }

  // Try to detect reference month/year if mentioned in a top banner row or plan name (e.g. "NOVIEMBRE 2026", "11월", "11月", or "Plan Octubre")
  let refYear = options?.referenceYear || new Date().getFullYear();
  let refMonth = options?.referenceMonth || (new Date().getMonth() + 1);

  if (!options?.referenceYear || !options?.referenceMonth) {
    const searchSpace = [defaultCycleName, ...rows.slice(0, 6).map((r) => r.join(" "))].join(" ").toLowerCase();
    if (!options?.referenceYear) {
      const yearMatch = searchSpace.match(/\b(202\d|203\d)\b/) || searchSpace.match(/(202\d|203\d)\s*[년年]/);
      if (yearMatch) refYear = parseInt(yearMatch[1], 10);
    }
    if (!options?.referenceMonth) {
      const sortedMonthEntries = Object.entries(SPANISH_MONTHS).sort((a, b) => b[0].length - a[0].length);
      for (const [mWord, mCode] of sortedMonthEntries) {
        if ((mWord.length >= 4 || /[월月]/.test(mWord)) && searchSpace.includes(mWord)) {
          refMonth = parseInt(mCode, 10);
          break;
        }
      }
    }
  }

  // Also check if any cell in the sheet has a full YYYY-MM-DD or DD/MM/YYYY or MM/DD/YYYY date to anchor refYear & refMonth automatically
  if (!options?.referenceYear || !options?.referenceMonth) {
    outerDateScan: for (const r of rows.slice(0, 20)) {
      for (const c of r) {
        if (isValidDateCell(c)) {
          const norm = normalizeDateString(c, "", refYear, refMonth, preferMonthFirst);
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

        const date = normalizeDateString(rawDayCell, "", refYear, refMonth, preferMonthFirst);
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
          // Ignore weekday header rows across all supported languages
          if (STANDALONE_WEEKDAY_REGEX.test(cellVal)) {
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
        const arrowMatches = joinedAll.match(INLINE_ARROWS_REGEX);
        if (arrowMatches) {
          targetArrows = parseInt(arrowMatches[1], 10) || 0;
        }

        const lowerAll = joinedAll.toLowerCase();
        const isRestDay = isRestDayText(lowerAll) && targetArrows === 0;

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
          type: isRestDay
            ? "other"
            : isCompetitionText(lowerAll)
            ? "competition"
            : isMeetingText(lowerAll)
            ? "meeting"
            : "training",
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
    const focusCol = headerClasses.indexOf("focus");
    const notesCol = headerClasses.indexOf("notes");

    const maxCols = Math.max(...dataRows.map((r) => r.length), headerRow.length, 1);
    if (arrowsCol === -1 && maxCols >= 3) {
      for (let c = 0; c < maxCols; c++) {
        if (c === dateCol || c === titleCol || c === focusCol || c === notesCol) continue;
        const hText = (headerRow[c] || "").toLowerCase();
        if (
          hText &&
          classifyHeader(hText) !== "arrows" &&
          !hText.includes("meta") &&
          !hText.includes("goal") &&
          !hText.includes("qty") &&
          !hText.includes("anzahl")
        ) {
          continue;
        }
        const nonEmptyVals = dataRows.map((r) => (r[c] || "").trim()).filter(Boolean);
        if (
          nonEmptyVals.length > 0 &&
          nonEmptyVals.every((v) =>
            /^\d+(\s*(?:fl\.?|flechas?|tiros?|arrows?|shots?|setas?|fl[eè]ches?|pfeile?|frecce|화살|발|射数|射|本))?$/i.test(v)
          )
        ) {
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
        date = normalizeDateString(rawDateCell, fallback, refYear, refMonth, preferMonthFirst);
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

        // Skip if this column is just a standalone weekday name next to the date column (e.g. "Lunes", "Monday", "Lundi", "Montag", "월요일", "月曜日")
        if (c <= 1 && STANDALONE_WEEKDAY_REGEX.test(rawCellVal)) {
          continue;
        }

        const colHeader = (headerRow[c] || "").trim();
        const cleanDisplayVal = rawCellVal.replace(/\s*\|\|\|\s*/g, " · ");

        if (colHeader) {
          customFields.push({ label: colHeader, value: cleanDisplayVal });
        }

        // Convert cell into clean literal list item(s) for the day's list (never prepend invented labels)
        if (c !== arrowsCol) {
          const splitItems = splitCellIntoListItems(rawCellVal);
          splitItems.forEach((item) => {
            if (!rowItems.includes(item)) rowItems.push(item);
          });
        }

        if (c !== titleCol && c !== arrowsCol && c !== focusCol && c !== notesCol) {
          extraTextParts.push(cleanDisplayVal);
        }
      }

      if (targetArrows === 0) {
        const joinedRowText = row.filter((_, idx) => idx !== activeDateCol).join(" ");
        const inlineArrowsMatch = joinedRowText.match(INLINE_ARROWS_REGEX);
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
      const isRestWord = isRestDayText(lowerAll);

      const isRestDay = isRestWord && targetArrows === 0;

      const focusPoints = rawFocus
        ? rawFocus.split(/[,;•|]/).map((s) => s.trim()).filter(Boolean)
        : [];

      const combinedNotes = [rawNotes, ...extraTextParts].filter(Boolean).join(" · ");

      let type: "training" | "competition" | "meeting" | "other" = "training";
      if (isRestDay) {
        type = "other";
      } else if (isCompetitionText(lowerAll)) {
        type = "competition";
      } else if (isMeetingText(lowerAll)) {
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

    const startDate = normalizeDateString(rawStart, currentEstimatedStartDate, refYear, refMonth, preferMonthFirst);
    let endDate = normalizeDateString(rawEnd, startDate, refYear, refMonth, preferMonthFirst);
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

    currentEstimatedStartDate = getLocalISODate(new Date(endDate + "T12:00:00").getTime() + 24 * 60 * 60 * 1000);
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
 * Returns a clean, blank CSV template for Stages format (no pre-written activities)
 */
export function generateSampleCsvTemplate(): string {
  return [
    "Nombre de la Etapa,Fecha Inicio,Fecha Fin,Sesiones por Semana,Flechas por Semana,Notas"
  ].join("\r\n");
}

/**
 * Returns a clean, blank Day-by-Day CSV template (no pre-written activities)
 */
export function generateDailySampleCsvTemplate(): string {
  return [
    "Fecha,Actividad 1,Actividad 2,Actividad 3,Flechas,Notas"
  ].join("\r\n");
}

/**
 * Triggers an Android-compatible download/share of the Stages sample template in CSV format
 */
export function downloadSampleTemplate(): Promise<boolean> {
  return downloadOrShareFile({
    data: generateSampleCsvTemplate(),
    mimeType: "text/csv;charset=utf-8",
    addUtf8Bom: true,
    fileName: "Plantilla_Por_Etapas_Archery101010.csv"
  });
}

/**
 * Triggers an Android-compatible download/share of the Day-by-Day sample template in CSV format
 */
export function downloadDailySampleTemplate(): Promise<boolean> {
  return downloadOrShareFile({
    data: generateDailySampleCsvTemplate(),
    mimeType: "text/csv;charset=utf-8",
    addUtf8Bom: true,
    fileName: "Plantilla_Dia_Por_Dia_Archery101010.csv"
  });
}

/**
 * Async entry point for parsing either raw CSV/TSV text or a binary .xlsx/.xls ArrayBuffer.
 */
export async function parseCycleSpreadsheet(
  input: ArrayBuffer | string,
  defaultCycleName = "Imported Plan",
  options?: ParseSpreadsheetOptions
): Promise<ParsedCycleResult> {
  const isEs = (options?.lang || "es") === "es";
  if (typeof input === "string") {
    return parseSpreadsheetData(input, defaultCycleName, options);
  }
  const { sheetNames, getSheetTsv } = await parseExcelWorkbookBuffer(input);
  const firstSheet = sheetNames[0];
  if (!firstSheet) {
    const todayStr = getLocalISODate();
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
      error: isEs ? "El archivo no contiene hojas legibles." : "The file contains no readable sheets."
    };
  }
  return parseSpreadsheetData(getSheetTsv(firstSheet), defaultCycleName, options);
}

/**
 * Generates and downloads/shares a clean, 100% blank .xlsx workbook with the dates of the selected month
 * and zero pre-written or invented activities.
 */
export async function downloadFormattedExcelTemplate(
  year?: number,
  month?: number,
  lang = "es"
): Promise<boolean> {
  const XLSX = await loadXlsx();
  const isEs = lang === "es";
  const y = year || new Date().getFullYear();
  const m = month || (new Date().getMonth() + 1); // 1..12
  const daysInMonth = new Date(y, m, 0).getDate();
  const weekdayNames = isEs
    ? ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = isEs
    ? [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
      ]
    : [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
  const mName = monthNames[m - 1] || (isEs ? "Mes" : "Month");

  // Sheet 1: Clean Row-by-Row Date List (100% blank cells for the user to fill)
  const listAoA: string[][] = [
    isEs
      ? ["Fecha", "Día", "Tarea 1", "Tarea 2", "Tarea 3", "Flechas", "Notas"]
      : ["Date", "Day", "Task 1", "Task 2", "Task 3", "Arrows", "Notes"]
  ];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m - 1, d);
    const dow = dateObj.getDay();
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayLabel = `${weekdayNames[dow]} ${d}`;
    listAoA.push([dateStr, dayLabel, "", "", "", "", ""]);
  }

  const wb = XLSX.utils.book_new();
  const wsList = XLSX.utils.aoa_to_sheet(listAoA);
  wsList["!cols"] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 34 },
    { wch: 34 },
    { wch: 34 },
    { wch: 12 },
    { wch: 34 }
  ];
  XLSX.utils.book_append_sheet(wb, wsList, isEs ? `Lista ${mName}` : `List ${mName}`);

  // Sheet 2: Visual 7-Column Monthly Calendar Grid (100% blank cells under each day number)
  const gridAoA: string[][] = [
    [`${mName.toUpperCase()} ${y}`, "", "", "", "", "", ""],
    isEs
      ? ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
      : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  ];

  let currentDay = 1;
  while (currentDay <= daysInMonth) {
    const numberRow = ["", "", "", "", "", "", ""];
    const taskRow1 = ["", "", "", "", "", "", ""];
    const taskRow2 = ["", "", "", "", "", "", ""];
    const taskRow3 = ["", "", "", "", "", "", ""];

    for (let col = 0; col < 7 && currentDay <= daysInMonth; col++) {
      const dateObj = new Date(y, m - 1, currentDay);
      const monFirstCol = (dateObj.getDay() + 6) % 7;
      if (monFirstCol === col) {
        numberRow[col] = String(currentDay);
        currentDay++;
      }
    }

    gridAoA.push(numberRow, taskRow1, taskRow2, taskRow3);
  }

  const wsGrid = XLSX.utils.aoa_to_sheet(gridAoA);
  wsGrid["!cols"] = Array.from({ length: 7 }, () => ({ wch: 24 }));
  XLSX.utils.book_append_sheet(wb, wsGrid, isEs ? `Calendario ${mName}` : `Calendar ${mName}`);

  const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return downloadOrShareFile({
    data: wbOut,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName: `${isEs ? "Formato_Plan" : "Plan_Template"}_${mName}_${y}_Archery101010.xlsx`
  });
}

/**
 * Exports an existing cycle into an Excel-ready CSV file (Android & Web compatible)
 */
export function exportCycleToCsv(cycle: Macrocycle): Promise<boolean> {
  const escapeCsvCell = (value: string | number | null | undefined): string =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const rows = [
    [
      "Nombre de la Etapa",
      "Fecha Inicio",
      "Fecha Fin",
      "Sesiones por Semana",
      "Flechas por Semana",
      "Notas para los Arqueros"
    ].map(escapeCsvCell)
  ];

  cycle.phases.forEach((p) => {
    rows.push([
      escapeCsvCell(p.name),
      escapeCsvCell(p.startDate),
      escapeCsvCell(p.endDate),
      escapeCsvCell(p.weeklySessionGoal),
      escapeCsvCell(p.weeklyArrowGoal),
      escapeCsvCell(p.notes || "")
    ]);
  });

  const csvContent = rows.map((r) => r.join(",")).join("\r\n");
  const safeName = (cycle.name || "Macrociclo").replace(/[^a-zA-Z0-9_\-]/g, "_");
  return downloadOrShareFile({
    data: csvContent,
    mimeType: "text/csv;charset=utf-8",
    addUtf8Bom: true,
    fileName: `Plan_${safeName}_Archery101010.csv`
  });
}
