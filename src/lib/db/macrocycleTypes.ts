export interface MacrocyclePhase {
  id: string;
  name: string;
  type?: string;
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

// Preset vibrant colors for Coach Stages (Etapas)
export const ETAPA_COLORS = [
  { name: "Cian", color: "#00E5FF" },
  { name: "Púrpura", color: "#8B5CF6" },
  { name: "Oro", color: "#FFE500" },
  { name: "Verde", color: "#10B981" },
  { name: "Rojo", color: "#EF4444" },
  { name: "Naranja", color: "#F97316" },
  { name: "Azul", color: "#3B82F6" },
  { name: "Rosa", color: "#EC4899" }
];

// Fallback legacy mapping for existing records
export const PHASE_CONFIG: Record<string, { label: string; color: string }> = {
  fisica: { label: "Etapa Física", color: "#8B5CF6" },
  volumen: { label: "Etapa de Volumen", color: "#00BFFF" },
  puesta_punto: { label: "Etapa de Puesta a Punto", color: "#FFE500" },
  competitiva: { label: "Etapa Competitiva", color: "#FF0000" },
  transicion: { label: "Etapa de Transición", color: "#00C853" },
  descanso: { label: "Etapa de Descanso", color: "#FFFFFF" }
};
