import { Macrocycle, MacrocyclePhase, PHASE_CONFIG } from "@/lib/db/macrocycleTypes";
import { 
  CalendarEvent, 
  saveLocalEvent, 
  addToSyncQueue, 
  generateResilientId 
} from "@/lib/db/indexedDB";
import { UserProfile } from "@/lib/authService";
import { ParsedDailyEntry } from "@/lib/cycleImporter";

export interface SyncCycleSummary {
  syncedDaysCount: number;
  trainingDaysCount: number;
  restDaysCount: number;
  totalArrowsAssigned: number;
  macrocycleName: string;
  monthName: string;
  year: number;
}

/**
 * Returns tailored focus points based on the training phase
 */
export function getRecommendedFocusPoints(phaseType?: string): string[] {
  const normalized = (phaseType || "").toLowerCase();
  if (normalized.includes("fisic") || normalized.includes("físic") || normalized.includes("base") || normalized.includes("fuerza")) {
    return [
      "Calentamiento articular dinámico",
      "Fuerza específica con banda elástica (15-20 min)",
      "Volumen moderado con control postural y core",
      "Estiramientos de tren superior y espalda"
    ];
  }
  if (normalized.includes("volumen") || normalized.includes("carga") || normalized.includes("tiro")) {
    return [
      "Calentamiento de hombros y escápulas",
      "Ritmo de disparo constante (tiempo regular por flecha)",
      "Expansión continua sin colapsar el anclaje",
      "Registro y conteo estricto del volumen de tiro"
    ];
  }
  if (normalized.includes("puesta") || normalized.includes("punto") || normalized.includes("tecnic") || normalized.includes("técnic")) {
    return [
      "Alineación visual y encare perfecto",
      "Control del clic sincronizado con la soltada",
      "Agrupamiento fino a la distancia reglamentaria",
      "Evaluación de puntuación por tandas oficiales"
    ];
  }
  if (normalized.includes("compet") || normalized.includes("duelo") || normalized.includes("torneo")) {
    return [
      "Protocolo oficial de tiro (tiempo y juez simulado)",
      "Duelo 1 contra 1 eliminatorio bajo presión",
      "Control de respiración diafragmática pre-disparo",
      "Rutina de anclaje firme en momentos clave"
    ];
  }
  if (normalized.includes("transic") || normalized.includes("manten")) {
    return [
      "Tiro técnico libre sin conteo de puntos",
      "Revisión y mantenimiento del material y cuerdas",
      "Sensaciones de soltada fluida y relajada",
      "Flexibilidad y movilidad general"
    ];
  }
  return [
    "Ejecución técnica consciente y regular",
    "Postura de tiro y control del anclaje",
    "Ritmo y respiración constante por flecha",
    "Cumplimiento del objetivo asignado por el entrenador"
  ];
}

/**
 * Determines whether a day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 * is a designated training day according to weekly session goal.
 */
export function isTrainingDayForWeeklyGoal(dayOfWeek: number, weeklyGoal: number): boolean {
  const goal = Math.max(1, Math.min(7, weeklyGoal));
  switch (goal) {
    case 1:
      // 1 day: Saturday
      return dayOfWeek === 6;
    case 2:
      // 2 days: Tuesday, Thursday
      return dayOfWeek === 2 || dayOfWeek === 4;
    case 3:
      // 3 days: Monday, Wednesday, Friday
      return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
    case 4:
      // 4 days: Monday, Wednesday, Friday, Saturday
      return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5 || dayOfWeek === 6;
    case 5:
      // 5 days: Monday, Tuesday, Wednesday, Friday, Saturday
      return [1, 2, 3, 5, 6].includes(dayOfWeek);
    case 6:
      // 6 days: Monday through Saturday
      return dayOfWeek >= 1 && dayOfWeek <= 6;
    case 7:
    default:
      return true;
  }
}

/**
 * Synchronizes a macrocycle / mesocycle for a specific month with the app's calendar.
 * Generates daily coach assignments with arrow targets, technical focus, and notes.
 */
export async function syncCycleToMonthCalendar(
  macrocycle: Macrocycle,
  year: number,
  month: number, // 0-indexed (0 = January, 11 = December)
  coach: UserProfile,
  options?: {
    customNotes?: string;
  }
): Promise<SyncCycleSummary> {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const monthName = monthNames[month] || `Mes ${month + 1}`;

  let syncedDaysCount = 0;
  let trainingDaysCount = 0;
  let restDaysCount = 0;
  let totalArrowsAssigned = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // Verify if this date falls within the macrocycle active window
    if (dateStr < macrocycle.startDate || dateStr > macrocycle.endDate) {
      continue;
    }

    // Find the active phase for this date
    const phase: MacrocyclePhase | undefined = macrocycle.phases?.find(
      (p) => dateStr >= p.startDate && dateStr <= p.endDate
    );

    if (!phase) {
      continue;
    }

    const dayOfWeek = new Date(year, month, day).getDay();
    const isTraining = isTrainingDayForWeeklyGoal(dayOfWeek, phase.weeklySessionGoal);
    const arrowsPerSession = isTraining 
      ? Math.round(phase.weeklyArrowGoal / Math.max(1, phase.weeklySessionGoal))
      : 0;

    const focusPoints = isTraining 
      ? getRecommendedFocusPoints(phase.type || phase.name)
      : ["Descanso neuromuscular y recuperación activa", "Hidratación y estiramiento ligero"];

    // Deterministic ID per macrocycle and date prevents duplicate cards on multiple syncs
    const eventId = `EVT-MAC-${macrocycle.id}-${dateStr}`;

    const title = isTraining
      ? `🎯 Plan Coach: ${phase.name} (${arrowsPerSession} flechas)`
      : `🌿 Descanso / Recuperación (${phase.name})`;

    const description = isTraining
      ? `Asignación del entrenador para la etapa ${phase.name}. Meta diaria: ${arrowsPerSession} flechas. Enfoque: ${focusPoints[0]}.`
      : `Día de recuperación física y neuromuscular planificado dentro de la etapa ${phase.name}.`;

    const coachNotes = options?.customNotes || phase.notes || (
      isTraining
        ? `Cumplir las ${arrowsPerSession} flechas asignadas manteniendo postura olímpica y ritmo constante.`
        : "Asimilar las cargas de tiro de la semana. Descanso activo."
    );

    const eventData: CalendarEvent = {
      id: eventId,
      title,
      date: dateStr,
      description,
      createdByRole: "coach",
      createdByName: coach.fullName || "Coach Director",
      createdByUid: coach.uid,
      clubId: coach.clubId || macrocycle.clubId,
      type: isTraining ? "training" : "other",
      timestamp: Date.now(),
      // Cycle metadata
      macrocycleId: macrocycle.id,
      phaseId: phase.id,
      phaseName: phase.name,
      phaseType: phase.type,
      phaseColor: phase.color || (phase.type && PHASE_CONFIG[phase.type] ? PHASE_CONFIG[phase.type].color : "#00BFFF"),
      targetArrows: arrowsPerSession,
      assignedAthleteIds: macrocycle.assignmentType === "club" ? [] : (macrocycle.assignedAthleteIds || []),
      focusPoints,
      coachNotes,
      isRestDay: !isTraining,
      isCompleted: false
    };

    // Save locally
    await saveLocalEvent(eventId, eventData);

    // Queue for cloud sync
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "calendar_events",
      operation: "UPDATE",
      payloadId: eventId,
      payload: eventData,
      timestamp: Date.now()
    });

    syncedDaysCount++;
    if (isTraining) {
      trainingDaysCount++;
      totalArrowsAssigned += arrowsPerSession;
    } else {
      restDaysCount++;
    }
  }

  // Dispatch local db change event for instant reactive rendering
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("local-db-change", { detail: { store: "calendar_events" } })
    );
  }

  return {
    syncedDaysCount,
    trainingDaysCount,
    restDaysCount,
    totalArrowsAssigned,
    macrocycleName: macrocycle.name,
    monthName,
    year
  };
}

/**
 * Directly saves day-by-day rows imported from Excel / Google Sheets into the Calendar,
 * preserving each day's exact title, arrow count, focus points, and notes.
 */
export async function saveDailyEntriesToCalendar(
  dailyEntries: ParsedDailyEntry[],
  macrocycle: Macrocycle,
  author: UserProfile
): Promise<SyncCycleSummary> {
  let syncedDaysCount = 0;
  let trainingDaysCount = 0;
  let restDaysCount = 0;
  let totalArrowsAssigned = 0;

  for (const entry of dailyEntries) {
    const phase = macrocycle.phases?.find(
      (p) => entry.date >= p.startDate && entry.date <= p.endDate
    ) || macrocycle.phases?.[0];

    const eventId = `EVT-MAC-${macrocycle.id}-${entry.date}`;
    const isCoach = author.role === "coach";

    const eventData: CalendarEvent = {
      id: eventId,
      title: entry.title,
      date: entry.date,
      description: entry.notes,
      createdByRole: isCoach ? "coach" : "archer",
      createdByName: author.fullName || (isCoach ? "Coach Director" : "Arquero"),
      createdByUid: author.uid,
      clubId: author.clubId || macrocycle.clubId,
      type: entry.type,
      timestamp: Date.now(),
      macrocycleId: macrocycle.id,
      phaseId: phase?.id,
      phaseName: phase?.name || entry.stageName || macrocycle.name,
      phaseType: phase?.type,
      phaseColor: phase?.color || "#00E5FF",
      targetArrows: entry.targetArrows,
      assignedAthleteIds: macrocycle.assignmentType === "club" ? [] : (macrocycle.assignedAthleteIds || []),
      focusPoints: entry.focusPoints,
      coachNotes: entry.notes,
      isRestDay: entry.isRestDay,
      isCompleted: false
    };

    await saveLocalEvent(eventId, eventData);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "calendar_events",
      operation: "UPDATE",
      payloadId: eventId,
      payload: eventData,
      timestamp: Date.now()
    });

    syncedDaysCount++;
    if (entry.isRestDay) {
      restDaysCount++;
    } else {
      trainingDaysCount++;
      totalArrowsAssigned += entry.targetArrows;
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("local-db-change", { detail: { store: "calendar_events" } })
    );
  }

  const firstDate = dailyEntries[0]?.date ? new Date(dailyEntries[0].date + "T12:00:00") : new Date();
  const monthName = firstDate.toLocaleDateString("es-ES", { month: "long" });

  return {
    syncedDaysCount,
    trainingDaysCount,
    restDaysCount,
    totalArrowsAssigned,
    macrocycleName: macrocycle.name,
    monthName: monthName.charAt(0).toUpperCase() + monthName.slice(1),
    year: firstDate.getFullYear()
  };
}

/**
 * Synchronizes ALL months covered by a stage-based Macrocycle in a single operation.
 */
export async function syncEntireMacrocycleToCalendar(
  macrocycle: Macrocycle,
  author: UserProfile
): Promise<SyncCycleSummary> {
  const start = new Date(macrocycle.startDate + "T12:00:00");
  const end = new Date(macrocycle.endDate + "T12:00:00");

  let syncedDaysCount = 0;
  let trainingDaysCount = 0;
  let restDaysCount = 0;
  let totalArrowsAssigned = 0;

  let curYear = start.getFullYear();
  let curMonth = start.getMonth();
  const endYear = end.getFullYear();
  const endMonth = end.getMonth();

  // Safety cap of 18 months max
  let guard = 0;
  while ((curYear < endYear || (curYear === endYear && curMonth <= endMonth)) && guard < 18) {
    const res = await syncCycleToMonthCalendar(macrocycle, curYear, curMonth, author);
    syncedDaysCount += res.syncedDaysCount;
    trainingDaysCount += res.trainingDaysCount;
    restDaysCount += res.restDaysCount;
    totalArrowsAssigned += res.totalArrowsAssigned;

    curMonth++;
    if (curMonth > 11) {
      curMonth = 0;
      curYear++;
    }
    guard++;
  }

  return {
    syncedDaysCount,
    trainingDaysCount,
    restDaysCount,
    totalArrowsAssigned,
    macrocycleName: macrocycle.name,
    monthName: `${macrocycle.startDate} al ${macrocycle.endDate}`,
    year: start.getFullYear()
  };
}
