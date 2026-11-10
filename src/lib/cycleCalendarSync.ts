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
export function getRecommendedFocusPoints(_phaseType?: string): string[] {
  // Transfiere estrictamente el documento del usuario sin inventar textos
  return [];
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
 * Computes a deterministic short alphanumeric hash from sorted athlete UIDs
 * so syncing Group A and Group B on the same macrocycle never overwrites each other's EVT-MAC-* documents.
 */
function computeDeterministicGroupHash(athleteIds: string[]): string {
  const canonical = [...athleteIds].sort().join("|");
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

function buildAssignmentEventSuffix(assignedAthleteIds: string[]): string {
  if (!assignedAthleteIds || assignedAthleteIds.length === 0) return "";
  if (assignedAthleteIds.length === 1) return `-${assignedAthleteIds[0]}`;
  return `-GRP-${computeDeterministicGroupHash(assignedAthleteIds)}`;
}

function resolveCanonicalClubId(
  primaryClubId?: string | null,
  secondaryClubId?: string | null,
  fallbackUid?: string
): string | undefined {
  if (primaryClubId && primaryClubId !== "CLB-DEMO") return primaryClubId;
  if (secondaryClubId && secondaryClubId !== "CLB-DEMO") return secondaryClubId;
  return fallbackUid ? `CLB-${fallbackUid}` : undefined;
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
    targetAthleteId?: string;
    targetAthleteIds?: string[];
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

  const explicitTargets = options?.targetAthleteIds !== undefined
    ? options.targetAthleteIds
    : options?.targetAthleteId
    ? [options.targetAthleteId]
    : null;

  const assignedAthleteIds = explicitTargets !== null
    ? explicitTargets
    : (macrocycle.assignmentType === "club" ? [] : (macrocycle.assignedAthleteIds || []));

  const eventSuffix = buildAssignmentEventSuffix(assignedAthleteIds);
  const canonicalClubId = resolveCanonicalClubId(coach.clubId, macrocycle.clubId, coach.uid);

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
    const isTraining = phase.weeklySessionGoal > 0 ? isTrainingDayForWeeklyGoal(dayOfWeek, phase.weeklySessionGoal) : true;
    if (!isTraining) {
      restDaysCount++;
      continue;
    }
    const arrowsPerSession = phase.weeklyArrowGoal > 0 && phase.weeklySessionGoal > 0
      ? Math.round(phase.weeklyArrowGoal / Math.max(1, phase.weeklySessionGoal))
      : 0;

    const focusPoints: string[] = [];

    // Deterministic ID per macrocycle, target athlete/group and date prevents duplicate cards or group overwrites
    const eventId = `EVT-MAC-${macrocycle.id}${eventSuffix}-${dateStr}`;

    const title = phase.name || macrocycle.name;
    const description = options?.customNotes || phase.notes || "";
    const coachNotes = options?.customNotes || phase.notes || "";
    const dailyItems = coachNotes
      ? [title, ...coachNotes.split(/\r?\n|\s*;\s*/).map((s) => s.trim()).filter(Boolean)]
      : [title];

    const eventData: CalendarEvent = {
      id: eventId,
      title,
      date: dateStr,
      description,
      createdByRole: "coach",
      createdByName: coach.fullName || "Coach Director",
      createdByUid: coach.uid,
      clubId: canonicalClubId,
      type: isTraining ? "training" : "other",
      timestamp: Date.now(),
      // Cycle metadata
      macrocycleId: macrocycle.id,
      phaseId: phase.id,
      phaseName: phase.name,
      phaseType: phase.type,
      phaseColor: phase.color || (phase.type && PHASE_CONFIG[phase.type] ? PHASE_CONFIG[phase.type].color : "#00BFFF"),
      targetArrows: arrowsPerSession,
      assignedAthleteIds,
      focusPoints,
      coachNotes,
      dailyItems,
      completedItems: [],
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

  const assignedList = macrocycle.assignmentType === "club" ? [] : (macrocycle.assignedAthleteIds || []);
  const eventSuffix = buildAssignmentEventSuffix(assignedList);
  const isCoach =
    author.role === "coach" ||
    author.role === "team_admin_coach" ||
    author.role === "team_admin" ||
    author.role === "superadmin" ||
    macrocycle.coachId === author.uid;
  const canonicalClubId = isCoach
    ? resolveCanonicalClubId(author.clubId, macrocycle.clubId, author.uid)
    : (author.clubId && author.clubId !== "CLB-DEMO" ? author.clubId : macrocycle.clubId || undefined);

  for (const entry of dailyEntries) {
    const phase = macrocycle.phases?.find(
      (p) => entry.date >= p.startDate && entry.date <= p.endDate
    ) || macrocycle.phases?.[0];

    const eventId = `EVT-MAC-${macrocycle.id}${eventSuffix}-${entry.date}`;

    const eventData: CalendarEvent = {
      id: eventId,
      title: entry.title,
      date: entry.date,
      description: entry.notes,
      createdByRole: isCoach ? "coach" : "archer",
      createdByName: author.fullName || (isCoach ? "Coach Director" : "Arquero"),
      createdByUid: author.uid,
      clubId: canonicalClubId,
      type: entry.type,
      timestamp: Date.now(),
      macrocycleId: macrocycle.id,
      phaseId: phase?.id,
      phaseName: phase?.name || entry.stageName || macrocycle.name,
      phaseType: phase?.type,
      phaseColor: phase?.color || "#00A8F3",
      targetArrows: entry.targetArrows,
      assignedAthleteIds: assignedList,
      focusPoints: entry.focusPoints,
      coachNotes: entry.notes,
      customFields: entry.customFields,
      dailyItems: entry.dailyItems && entry.dailyItems.length > 0 ? entry.dailyItems : [entry.title],
      completedItems: [],
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
 * Supports both (macrocycle, authorProfile) and (macrocycle, assignedIds, coachUid, coachFullName, clubId).
 */
export async function syncEntireMacrocycleToCalendar(
  macrocycle: Macrocycle,
  author: UserProfile
): Promise<SyncCycleSummary>;
export async function syncEntireMacrocycleToCalendar(
  macrocycle: Macrocycle,
  assignedIds: string[],
  coachUid: string,
  coachFullName?: string,
  clubId?: string | null
): Promise<SyncCycleSummary>;
export async function syncEntireMacrocycleToCalendar(
  macrocycle: Macrocycle,
  authorOrAssignedIds: UserProfile | string[],
  coachUid?: string,
  coachFullName?: string,
  clubId?: string | null
): Promise<SyncCycleSummary> {
  const isArrayOverload = Array.isArray(authorOrAssignedIds);
  const resolvedAuthor: UserProfile = isArrayOverload
    ? ({
        uid: coachUid || macrocycle.coachId,
        fullName: coachFullName || "Coach Director",
        email: "",
        role: "coach",
        clubId: resolveCanonicalClubId(clubId, macrocycle.clubId, coachUid || macrocycle.coachId)
      } as UserProfile)
    : authorOrAssignedIds;

  const targetAthleteIds = isArrayOverload ? authorOrAssignedIds : undefined;

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
    const res = await syncCycleToMonthCalendar(
      macrocycle,
      curYear,
      curMonth,
      resolvedAuthor,
      targetAthleteIds !== undefined ? { targetAthleteIds } : undefined
    );
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

/**
 * Unlinks and deletes a plan and all its calendar events from IndexedDB and sync queue.
 * - If targetAthleteId is provided: unlinks only that athlete from the macrocycle (or all macrocycles when macrocycleId === "*") and their events.
 * - If targetAthleteId is omitted: completely deletes the macrocycle and ALL associated calendar events.
 */
export async function unlinkAndPurgePlan(
  macrocycleId: string,
  targetAthleteId?: string
): Promise<{ deletedEventsCount: number; planDeleted: boolean }> {
  const { 
    getLocalMacrocycles, 
    saveLocalMacrocycle, 
    deleteLocalMacrocycle, 
    getLocalEvents, 
    deleteLocalEvent, 
    saveLocalEvent,
    generateResilientId, 
    addToSyncQueue 
  } = await import("@/lib/db/indexedDB");

  let deletedEventsCount = 0;
  let planDeleted = false;

  const macrocycles = await getLocalMacrocycles();
  const events = await getLocalEvents();

  if (targetAthleteId) {
    const candidateMacros = macrocycleId === "*"
      ? macrocycles.filter((m: Macrocycle) => (m.assignedAthleteIds || []).includes(targetAthleteId))
      : macrocycles.filter((m: Macrocycle) => m.id === macrocycleId);

    for (const targetMacro of candidateMacros) {
      const updatedAthleteIds = (targetMacro.assignedAthleteIds || []).filter(
        (id: string) => id !== targetAthleteId
      );
      targetMacro.assignedAthleteIds = updatedAthleteIds;
      if (
        (targetMacro.assignmentType === "individual" || targetMacro.assignmentType === "group") &&
        updatedAthleteIds.length === 0
      ) {
        await deleteLocalMacrocycle(targetMacro.id);
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "macrocycles",
          operation: "DELETE",
          payloadId: targetMacro.id,
          payload: { id: targetMacro.id },
          timestamp: Date.now()
        });
        planDeleted = true;
      } else {
        await saveLocalMacrocycle(targetMacro.id, targetMacro);
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "macrocycles",
          operation: "UPDATE",
          payloadId: targetMacro.id,
          payload: targetMacro,
          timestamp: Date.now()
        });
      }
    }

    // Delete or update events for this athlete
    for (const ev of events) {
      if (macrocycleId === "*" || ev.macrocycleId === macrocycleId) {
        if (ev.assignedAthleteIds && ev.assignedAthleteIds.includes(targetAthleteId)) {
          const remainingAthletes = ev.assignedAthleteIds.filter((id: string) => id !== targetAthleteId);
          if (remainingAthletes.length === 0) {
            await deleteLocalEvent(ev.id);
            await addToSyncQueue({
              id: generateResilientId("TXN"),
              collection: "calendar_events",
              operation: "DELETE",
              payloadId: ev.id,
              payload: { id: ev.id },
              timestamp: Date.now()
            });
            deletedEventsCount++;
          } else {
            ev.assignedAthleteIds = remainingAthletes;
            const evAny = ev as CalendarEvent & { completedByAthlete?: Record<string, number[]> };
            if (evAny.completedByAthlete && targetAthleteId in evAny.completedByAthlete) {
              const nextMap = { ...evAny.completedByAthlete };
              delete nextMap[targetAthleteId];
              evAny.completedByAthlete = nextMap;
            }
            await saveLocalEvent(ev.id, ev);
            await addToSyncQueue({
              id: generateResilientId("TXN"),
              collection: "calendar_events",
              operation: "UPDATE",
              payloadId: ev.id,
              payload: ev,
              timestamp: Date.now()
            });
          }
        }
      }
    }
  } else {
    // Complete unlink and deletion of the plan
    const targetMacro = macrocycles.find((m: Macrocycle) => m.id === macrocycleId);
    if (targetMacro || macrocycleId) {
      await deleteLocalMacrocycle(macrocycleId);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "macrocycles",
        operation: "DELETE",
        payloadId: macrocycleId,
        payload: { id: macrocycleId },
        timestamp: Date.now()
      });
      planDeleted = true;
    }

    // Delete ALL events tied to this macrocycle
    for (const ev of events) {
      if (ev.macrocycleId === macrocycleId) {
        await deleteLocalEvent(ev.id);
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "calendar_events",
          operation: "DELETE",
          payloadId: ev.id,
          payload: { id: ev.id },
          timestamp: Date.now()
        });
        deletedEventsCount++;
      }
    }
  }

  // Notify listeners to update UI reactively
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("local-db-change", { detail: { store: "macrocycles_local" } })
    );
    window.dispatchEvent(
      new CustomEvent("local-db-change", { detail: { store: "calendar_events" } })
    );
  }

  return { deletedEventsCount, planDeleted };
}
