export interface MacrocyclePhase {
  id: string;
  name: string;
  type: "fisica" | "volumen" | "puesta_punto" | "competitiva" | "transicion" | "descanso";
  startDate: string; // YYYY-MM-DD
  endDate: string;
  weeklySessionGoal: number;
  weeklyArrowGoal: number;
  notes: string;
  color: string; // hex color
}

export interface Macrocycle {
  id: string; // "MAC-timestamp-random"
  name: string;
  coachId: string;
  clubId: string;
  startDate: string;
  endDate: string;
  phases: MacrocyclePhase[];
  assignmentType: "club" | "group" | "individual";
  assignedAthleteIds: string[];
  groupName?: string;
  volumeGoal: number;
  currentVolume: number;
  status: "active" | "completed" | "draft";
  createdAt: string;
  updatedAt: string;
}

// Phase type to display name and default color mapping
export const PHASE_CONFIG: Record<MacrocyclePhase["type"], { label: string; color: string }> = {
  fisica: { label: "Preparación Física", color: "#8B5CF6" },
  volumen: { label: "Volumen", color: "#00BFFF" },
  puesta_punto: { label: "Puesta a Punto", color: "#FFE500" },
  competitiva: { label: "Competitiva", color: "#FF0000" },
  transicion: { label: "Transición", color: "#00C853" },
  descanso: { label: "Descanso", color: "#8E8E93" }
};
