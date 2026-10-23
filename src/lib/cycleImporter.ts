import { Macrocycle, MacrocyclePhase, ETAPA_COLORS } from "@/lib/db/macrocycleTypes";

export interface ParsedCycleResult {
  success: boolean;
  planName: string;
  startDate: string;
  endDate: string;
  totalVolumeGoal: number;
  stages: MacrocyclePhase[];
  warnings: string[];
  error?: string;
}

/**
 * Normalizes dates from formats like DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD into standard YYYY-MM-DD
 */
export function normalizeDateString(raw: string, fallbackDate: string): string {
  if (!raw) return fallbackDate;
  const trimmed = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // YYYY/MM/DD
  const ymdMatch = trimmed.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return fallbackDate;
}

/**
 * Parses raw text copied and pasted from Excel, Google Sheets, or CSV file.
 * Automatically recognizes tab-separated, comma-separated, or semicolon-separated values.
 */
export function parseSpreadsheetData(rawText: string, defaultCycleName = "Nuevo Ciclo Importado"): ParsedCycleResult {
  const warnings: string[] = [];
  if (!rawText || !rawText.trim()) {
    return {
      success: false,
      planName: defaultCycleName,
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
      totalVolumeGoal: 0,
      stages: [],
      warnings: [],
      error: "No se encontró texto o celdas para importar. Copia las celdas de Excel o Google Sheets."
    };
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      success: false,
      planName: defaultCycleName,
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
      totalVolumeGoal: 0,
      stages: [],
      warnings: [],
      error: "El texto ingresado está vacío."
    };
  }

  // Detect delimiter: check first line
  const firstLine = lines[0];
  let delimiter = "\t"; // Default for clipboard copy from Excel / Google Sheets
  if (firstLine.includes("\t")) {
    delimiter = "\t";
  } else if (firstLine.includes(";")) {
    delimiter = ";";
  } else if (firstLine.includes(",")) {
    delimiter = ",";
  }

  // Split lines into cell rows
  const rows = lines.map((line) => {
    // Handle simple quotes in CSV
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

  // Check if first row is a header
  let dataRows = rows;
  let headers = ["nombre", "inicio", "fin", "sesiones", "flechas", "notas"];
  const headerCandidates = rows[0].map((c) => c.toLowerCase());
  const isHeader = headerCandidates.some(
    (c) =>
      c.includes("etapa") ||
      c.includes("fase") ||
      c.includes("nombre") ||
      c.includes("inicio") ||
      c.includes("fecha") ||
      c.includes("flechas") ||
      c.includes("sesion") ||
      c.includes("notas")
  );

  let nameCol = 0;
  let startCol = 1;
  let endCol = 2;
  let sessionsCol = 3;
  let arrowsCol = 4;
  let notesCol = 5;

  if (isHeader) {
    headerCandidates.forEach((header, idx) => {
      if (header.includes("etapa") || header.includes("nombre") || header.includes("fase")) nameCol = idx;
      else if (header.includes("inicio") || (header.includes("desde") && !header.includes("fin"))) startCol = idx;
      else if (header.includes("fin") || header.includes("hasta")) endCol = idx;
      else if (header.includes("sesion") || header.includes("dias")) sessionsCol = idx;
      else if (header.includes("flecha") || header.includes("tiros") || header.includes("volumen")) arrowsCol = idx;
      else if (header.includes("nota") || header.includes("enfoque") || header.includes("indicacion") || header.includes("detalle")) notesCol = idx;
    });
    dataRows = rows.slice(1);
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const parsedStages: MacrocyclePhase[] = [];
  let currentEstimatedStartDate = todayStr;

  dataRows.forEach((row, idx) => {
    if (row.length === 0 || (row.length === 1 && !row[0])) return;

    // Stage name
    const rawName = row[nameCol] || `Etapa ${idx + 1}`;
    
    // Dates
    const rawStart = row[startCol];
    const rawEnd = row[endCol];

    let startDate = normalizeDateString(rawStart, currentEstimatedStartDate);
    let endDate = normalizeDateString(
      rawEnd,
      new Date(new Date(startDate).getTime() + 21 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
    );

    // If endDate is before startDate, adjust
    if (endDate < startDate) {
      endDate = new Date(new Date(startDate).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    }

    // Sessions and arrows
    const rawSessions = row[sessionsCol];
    const sessions = parseInt(rawSessions || "3", 10) || 3;

    const rawArrows = row[arrowsCol];
    const arrows = parseInt((rawArrows || "300").replace(/[^0-9]/g, ""), 10) || 300;

    // Notes
    const notes = row[notesCol] || "";

    // Pick color
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

    // Advance estimated start date for next stage
    currentEstimatedStartDate = new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  });

  if (parsedStages.length === 0) {
    return {
      success: false,
      planName: defaultCycleName,
      startDate: todayStr,
      endDate: todayStr,
      totalVolumeGoal: 0,
      stages: [],
      warnings: [],
      error: "No se pudieron identificar etapas válidas en las filas proporcionadas."
    };
  }

  const cycleStartDate = parsedStages[0].startDate;
  const cycleEndDate = parsedStages[parsedStages.length - 1].endDate;

  // Calculate total volume goal across all stages (sum of weeklyArrowGoal * estimated weeks)
  let totalVolumeGoal = 0;
  parsedStages.forEach((st) => {
    const startMs = new Date(st.startDate).getTime();
    const endMs = new Date(st.endDate).getTime();
    const weeks = Math.max(1, Math.round((endMs - startMs) / (7 * 24 * 60 * 60 * 1000)));
    totalVolumeGoal += st.weeklyArrowGoal * weeks;
  });

  return {
    success: true,
    planName: defaultCycleName,
    startDate: cycleStartDate,
    endDate: cycleEndDate,
    totalVolumeGoal: Math.max(1000, totalVolumeGoal),
    stages: parsedStages,
    warnings
  };
}

/**
 * Returns a ready-to-use CSV sample text for Coaches
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
 * Triggers a browser download of the sample template in CSV/Excel format
 */
export function downloadSampleTemplate(): void {
  const csvContent = "\uFEFF" + generateSampleCsvTemplate(); // UTF-8 BOM for Excel compatibility
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "Plantilla_Plan_Entrenamiento_Archery101010.csv");
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
