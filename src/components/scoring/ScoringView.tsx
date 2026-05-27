"use client";

import React, { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { saveLocalSession, generateResilientId, addToSyncQueue, getLocalSetting, deleteLocalSession } from "@/lib/db/indexedDB";
import { runSync } from "@/lib/db/syncManager";
import FloatingClock from "./FloatingClock";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Target, Keyboard, Save, SkipForward, ArrowRight, MessageSquare, Maximize2, Undo2 } from "lucide-react";
import confetti from "canvas-confetti";

interface ScoringViewProps {
  user: UserProfile;
  config: any; // configurations from SessionConfigView
  onBack: () => void;
  onSessionSaved: () => void;
}

interface EndData {
  arrows: Array<string>; // "X", "10", "9", "8", ..., "1", "M"
  note: string;
}

interface ShotImpact {
  endIdx: number;
  arrowIdx: number;
  x: number; // percentage width of SVG
  y: number; // percentage height of SVG
  value: string;
}

export default function ScoringView({ user, config, onBack, onSessionSaved }: ScoringViewProps) {
  const { t } = useLanguage();
  const isBlockFormat = config.format === "WA 600" || config.format === "WA 720";

  // Mode state: Target (Diana) vs Keyboard (Teclado)
  const [mode, setMode] = useState<"TARGET" | "KEYBOARD">("TARGET");
  
  // Floating clock synchronization states
  const [clockDisabled, setClockDisabled] = useState(false);
  const [clockTimeStr, setClockTimeStr] = useState("");
  const [clockPhase, setClockPhase] = useState<"prep" | "shoot" | null>(null);
  const [clockIsOver, setClockIsOver] = useState(false);
  const [clockIsWarn, setClockIsWarn] = useState(false);

  // Scoring data states
  const [ends, setEnds] = useState<EndData[]>([]);
  const [currentEndIdx, setCurrentEndIdx] = useState(0);
  const [currentArrowIdx, setCurrentArrowIdx] = useState(0);
  const [impacts, setImpacts] = useState<ShotImpact[]>([]);

  // Touch drag states for Diana
  const [tempImpact, setTempImpact] = useState<ShotImpact | null>(null);
  const [isDraggingTarget, setIsDraggingTarget] = useState(false);

  // Exit & Zoom states
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [fontSize, setFontSize] = useState("normal");

  // Volume Confirmation States
  const [isConfirmingVolume, setIsConfirmingVolume] = useState(false);
  const [confirmedVolume, setConfirmedVolume] = useState(0);
  const [saveType, setSaveType] = useState<"full" | "partial">("full");

  // Notes state
  const [endNote, setEndNote] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [isFinishing, setIsFinishing] = useState(false); // Session summary modal state

  // Refs
  const dianaRef = useRef<SVGSVGElement | null>(null);
  const zoomedDianaRef = useRef<SVGSVGElement | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  // Load settings and restore draft if applicable on mount
  useEffect(() => {
    async function loadInitialSettings() {
      const size = await getLocalSetting<string>("font_size_scoring", "normal");
      setFontSize(size);
    }
    loadInitialSettings();

    if (config.isDraft) {
      setEnds(config.ends);
      setImpacts(config.impacts || []);
      setSessionNote(config.sessionNote || "");
      
      // Calculate first empty cell to focus on
      let targetEnd = 0;
      let targetArrow = 0;
      let foundEmpty = false;
      
      for (let e = 0; e < config.endsCount; e++) {
        const arr = config.ends[e]?.arrows || [];
        for (let a = 0; a < config.arrowsPerEnd; a++) {
          if (arr[a] === "" || arr[a] === undefined) {
            targetEnd = e;
            targetArrow = a;
            foundEmpty = true;
            break;
          }
        }
        if (foundEmpty) break;
      }
      
      if (!foundEmpty) {
        targetEnd = config.endsCount - 1;
        targetArrow = config.arrowsPerEnd - 1;
      }
      
      setCurrentEndIdx(targetEnd);
      setCurrentArrowIdx(targetArrow);
    } else {
      const initialEnds = Array.from({ length: config.endsCount }, () => ({
        arrows: Array.from({ length: config.arrowsPerEnd }, () => ""),
        note: ""
      }));
      setEnds(initialEnds);
    }
  }, [config]);

  // Autoguardado en caliente tras cada tiro o cambio de notas
  useEffect(() => {
    if (ends.length === 0) return;
    
    // Evitamos autoguardar si es el estado inicial vacío
    const hasAnyShot = ends.some(e => e.arrows.some(a => a !== ""));
    if (!hasAnyShot && impacts.length === 0) return;

    const autoSave = async () => {
      const sessionId = config.draftId || config.id || "SES-TEMP-DRAFT";
      const draftObj = {
        id: sessionId,
        userId: user.uid,
        userName: user.fullName,
        clubId: user.clubId,
        timestamp: config.timestamp || Date.now(),
        practiceType: config.practiceType,
        bowType: config.bowType,
        distance: config.distance,
        format: config.format,
        endsCount: config.endsCount,
        arrowsPerEnd: config.arrowsPerEnd,
        maxScore: config.maxScore,
        score: calculateTotalScore(),
        ends: ends,
        sessionNote: sessionNote,
        impacts: impacts,
        isDraft: true
      };
      
      try {
        await saveLocalSession(sessionId, draftObj);
      } catch (err) {
        console.error("Hot autosave failed", err);
      }
    };

    const timer = setTimeout(autoSave, 500);
    return () => clearTimeout(timer);
  }, [ends, impacts, sessionNote]);

  // Scroll active row into view in keyboard table
  useEffect(() => {
    if (tableContainerRef.current && mode === "KEYBOARD") {
      const container = tableContainerRef.current;
      const activeRow = container.querySelector(`tr[data-active="true"]`);
      if (activeRow) {
        activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [currentEndIdx, mode]);

  // Sum total score
  const getScoreValue = (val: string): number => {
    if (val === "X" || val === "10") return 10;
    if (val === "M" || val === "") return 0;
    return Number(val) || 0;
  };

  const calculateTotalScore = (): number => {
    let sum = 0;
    ends.forEach((e) => {
      e.arrows.forEach((a) => {
        sum += getScoreValue(a);
      });
    });
    return sum;
  };

  const calculateEndTotal = (endIdx: number): number => {
    if (!ends[endIdx]) return 0;
    return ends[endIdx].arrows.reduce((sum, val) => sum + getScoreValue(val), 0);
  };

  const calculateRunningTotal = (endIdx: number): number => {
    let runningSum = 0;
    for (let i = 0; i <= endIdx; i++) {
      runningSum += calculateEndTotal(i);
    }
    return runningSum;
  };

  // Keyboard tactile touch event handler
  const handleScoreInput = (value: string) => {
    if (currentEndIdx >= config.endsCount) return;

    setEnds((prevEnds) => {
      const newEnds = [...prevEnds];
      const currentEnd = { ...newEnds[currentEndIdx] };
      const currentArrows = [...currentEnd.arrows];

      currentArrows[currentArrowIdx] = value;
      currentEnd.arrows = currentArrows;
      newEnds[currentEndIdx] = currentEnd;

      return newEnds;
    });

    // Advance cell pointer index
    advanceCell();
  };

  const advanceCell = () => {
    if (currentArrowIdx < config.arrowsPerEnd - 1) {
      setCurrentArrowIdx(currentArrowIdx + 1);
    } else {
      // Completed current end arrows
      if (config.autoScore && currentEndIdx < config.endsCount - 1) {
        handleConfirmEnd();
      }
    }
  };

  const handleConfirmEnd = () => {
    setEnds((prevEnds) => {
      const newEnds = [...prevEnds];
      newEnds[currentEndIdx].note = endNote;
      return newEnds;
    });
    setEndNote("");

    if (currentEndIdx < config.endsCount - 1) {
      setCurrentEndIdx(currentEndIdx + 1);
      setCurrentArrowIdx(0);
    } else {
      // Completed all ends, trigger session summary notes modal
      setIsFinishing(true);
    }
  };

  const handleBackspace = () => {
    let targetArrow = currentArrowIdx;
    let targetEnd = currentEndIdx;

    // Si ya completamos todos los ends y la planilla está llena, retrocedemos al último casillero
    if (currentEndIdx >= config.endsCount) {
      targetEnd = config.endsCount - 1;
      targetArrow = config.arrowsPerEnd - 1;
    } else if (currentArrowIdx > 0) {
      targetArrow = currentArrowIdx - 1;
    } else if (currentEndIdx > 0) {
      targetEnd = currentEndIdx - 1;
      targetArrow = config.arrowsPerEnd - 1;
    } else {
      // Si estamos en la primera celda y tiene valor, lo borramos
      const firstArrow = ends[0]?.arrows[0];
      if (firstArrow && firstArrow !== "") {
        targetEnd = 0;
        targetArrow = 0;
      } else {
        return; // already at first cell and empty
      }
    }

    setCurrentEndIdx(targetEnd);
    setCurrentArrowIdx(targetArrow);

    setEnds((prevEnds) => {
      const newEnds = [...prevEnds];
      const end = { ...newEnds[targetEnd] };
      const arrows = [...end.arrows];
      
      // Clear corresponding impact and tempImpact
      setImpacts((prev) => prev.filter((imp) => !(imp.endIdx === targetEnd && imp.arrowIdx === targetArrow)));
      setTempImpact(null);

      arrows[targetArrow] = "";
      end.arrows = arrows;
      newEnds[targetEnd] = end;
      return newEnds;
    });
  };

  // Helper to convert client/touch coordinates to relative SVG percent coordinates
  const getCoordinatesFromEvent = (
    e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>,
    svgElement: SVGSVGElement | null
  ) => {
    if (!svgElement) return null;

    const rect = svgElement.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const pctX = ((clientX - rect.left) / rect.width) * 100;
    const pctY = ((clientY - rect.top) / rect.height) * 100;

    // Clamp coordinates inside diana bounds (0 to 100)
    const clampedX = Math.max(0, Math.min(100, pctX));
    const clampedY = Math.max(0, Math.min(100, pctY));

    // Calculate score value based on distance from center (50, 50)
    const dx = clampedX - 50;
    const dy = clampedY - 50;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let value = "M";
    if (distance < 2.5) value = "X";
    else if (distance < 5) value = "10";
    else if (distance < 10) value = "9";
    else if (distance < 15) value = "8";
    else if (distance < 20) value = "7";
    else if (distance < 25) value = "6";
    else if (distance < 30) value = "5";
    else if (distance < 35) value = "4";
    else if (distance < 40) value = "3";
    else if (distance < 45) value = "2";
    else if (distance < 50) value = "1";

    return { x: clampedX, y: clampedY, value };
  };

  // Touch drag state handlers
  const handleStartDrag = (
    e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>,
    fromZoom = false
  ) => {
    if (currentEndIdx >= config.endsCount) return;

    // Check if current end is already full of arrows
    const currentArrows = ends[currentEndIdx]?.arrows || [];
    const actualShots = currentArrows.filter(a => a !== "").length;
    if (actualShots >= config.arrowsPerEnd) {
      alert("Este End ya está completo. Confírmalo para pasar al siguiente.");
      return;
    }

    const svg = fromZoom ? zoomedDianaRef.current : dianaRef.current;
    const coords = getCoordinatesFromEvent(e, svg);
    if (coords) {
      setTempImpact({
        endIdx: currentEndIdx,
        arrowIdx: currentArrowIdx,
        x: coords.x,
        y: coords.y,
        value: coords.value
      });
      setIsDraggingTarget(true);
    }
  };

  const handleDrag = (
    e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>,
    fromZoom = false
  ) => {
    if (!isDraggingTarget) return;
    
    // Prevent default touch gestures (scrolling) while placing target arrows
    if (e.cancelable) {
      e.preventDefault();
    }

    const svg = fromZoom ? zoomedDianaRef.current : dianaRef.current;
    const coords = getCoordinatesFromEvent(e, svg);
    if (coords) {
      setTempImpact({
        endIdx: currentEndIdx,
        arrowIdx: currentArrowIdx,
        x: coords.x,
        y: coords.y,
        value: coords.value
      });
    }
  };

  const handleEndDrag = () => {
    setIsDraggingTarget(false);
  };

  const handleConfirmImpact = () => {
    if (!tempImpact) return;
    
    // Save impact marker coordinates
    setImpacts((prev) => [...prev, tempImpact]);
    
    // Register the score
    handleScoreInput(tempImpact.value);
    
    // Clear temp impact for next shot
    setTempImpact(null);
  };

  const handleSaveDraft = async () => {
    const sessionId = config.draftId || generateResilientId("SES");
    const draftObj = {
      id: sessionId,
      userId: user.uid,
      userName: user.fullName,
      clubId: user.clubId,
      timestamp: Date.now(),
      practiceType: config.practiceType,
      bowType: config.bowType,
      distance: config.distance,
      format: config.format,
      endsCount: config.endsCount,
      arrowsPerEnd: config.arrowsPerEnd,
      maxScore: config.maxScore,
      score: calculateTotalScore(),
      ends: ends,
      sessionNote: sessionNote,
      impacts: impacts,
      isDraft: true
    };

    try {
      await saveLocalSession(sessionId, draftObj);
      onSessionSaved(); // returns to Dashboard
    } catch (err) {
      console.error("Failed to save session draft", err);
    }
  };

  const handleDiscard = async () => {
    if (config.draftId) {
      await deleteLocalSession(config.draftId);
    }
    onBack(); // exits to Home
  };

  const triggerSaveFlow = (type: "full" | "partial") => {
    const scoredArrowsCount = ends.reduce((sum, e) => sum + e.arrows.filter(a => a !== "").length, 0);
    const halfEnds = Math.floor(config.endsCount / 2);
    const actualArrows = type === "partial" 
      ? ends.slice(0, halfEnds).reduce((sum, e) => sum + e.arrows.filter(a => a !== "").length, 0)
      : scoredArrowsCount;
      
    const totalVolumeInit = actualArrows + (config.warmupArrows || 0);
    
    setSaveType(type);
    setConfirmedVolume(totalVolumeInit);
    setIsConfirmingVolume(true);
    setIsFinishing(false); // Cerramos el modal de notas si estaba abierto
  };

  const handleFinishFirstBlockOnly = async () => {
    if (!confirm("¿Deseas finalizar el entrenamiento aquí guardando únicamente el 1er Bloque (primera mitad de flechas)?")) {
      return;
    }
    triggerSaveFlow("partial");
  };

  const executeSavePartialBlock = async (finalVolume: number) => {
    const halfEnds = Math.floor(config.endsCount / 2);
    const truncatedEnds = ends.slice(0, halfEnds);
    const truncatedImpacts = impacts.filter((imp) => imp.endIdx < halfEnds);
    const maxB1 = halfEnds * config.arrowsPerEnd * 10;
    
    let scoreB1 = 0;
    truncatedEnds.forEach((e) => {
      e.arrows.forEach((a) => {
        scoreB1 += getScoreValue(a);
      });
    });

    const sessionId = generateResilientId("SES");
    const sessionObj = {
      id: sessionId,
      userId: user.uid,
      userName: user.fullName,
      clubId: user.clubId,
      timestamp: Date.now(),
      practiceType: config.practiceType,
      bowType: config.bowType,
      distance: config.distance,
      format: `${config.format} (Bloque 1)`,
      endsCount: halfEnds,
      arrowsPerEnd: config.arrowsPerEnd,
      maxScore: maxB1,
      score: scoreB1,
      ends: truncatedEnds,
      sessionNote: sessionNote ? `${sessionNote} [Finalizado en primer bloque]` : "[Finalizado en primer bloque]",
      impacts: truncatedImpacts,
      singleBlockSaved: true,
      totalArrowsVolume: finalVolume,
      blockStats: {
        b1Score: scoreB1,
        b2Score: 0,
        diff: 0,
        completedB2: false
      }
    };

    try {
      if (config.draftId) {
        await deleteLocalSession(config.draftId);
      }
      await saveLocalSession(sessionId, sessionObj);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "sessions",
        operation: "INSERT",
        payloadId: sessionId,
        payload: sessionObj,
        timestamp: Date.now()
      });

      confetti({
        particleCount: 120,
        spread: 60,
        origin: { y: 0.8 },
        colors: ["#00E5FF", "#FFF200", "#FF3B30", "#00C853"]
      });

      runSync();
      onSessionSaved();
    } catch (err) {
      console.error("Failed to save partial block session", err);
    }
  };

  const handleFinishAndSave = async () => {
    triggerSaveFlow("full");
  };

  const executeSaveFull = async (finalVolume: number) => {
    const finalScore = calculateTotalScore();
    const sessionId = generateResilientId("SES");
    const halfEnds = Math.floor(config.endsCount / 2);

    let blockStats = undefined;
    if (isBlockFormat) {
      let b1Score = 0;
      let b2Score = 0;
      ends.forEach((e, idx) => {
        e.arrows.forEach((a) => {
          if (idx < halfEnds) {
            b1Score += getScoreValue(a);
          } else {
            b2Score += getScoreValue(a);
          }
        });
      });
      blockStats = {
        b1Score,
        b2Score,
        diff: b2Score - b1Score,
        completedB2: true
      };
    }

    const sessionObj = {
      id: sessionId,
      userId: user.uid,
      userName: user.fullName,
      clubId: user.clubId,
      timestamp: Date.now(),
      practiceType: config.practiceType,
      bowType: config.bowType,
      distance: config.distance,
      format: config.format,
      endsCount: config.endsCount,
      arrowsPerEnd: config.arrowsPerEnd,
      maxScore: config.maxScore,
      score: finalScore,
      ends: ends,
      sessionNote: sessionNote,
      impacts: impacts,
      totalArrowsVolume: finalVolume,
      blockStats
    };

    try {
      if (config.draftId) {
        await deleteLocalSession(config.draftId);
      }

      await saveLocalSession(sessionId, sessionObj);

      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "sessions",
        operation: "INSERT",
        payloadId: sessionId,
        payload: sessionObj,
        timestamp: Date.now()
      });

      confetti({
        particleCount: 120,
        spread: 60,
        origin: { y: 0.8 },
        colors: ["#00E5FF", "#FFF200", "#FF3B30", "#00C853"]
      });

      runSync();
      onSessionSaved();
    } catch (err) {
      console.error("Failed to save session", err);
    }
  };

  const executeFinalSave = async (finalVolume: number) => {
    setIsConfirmingVolume(false);
    if (saveType === "partial") {
      await executeSavePartialBlock(finalVolume);
    } else {
      await executeSaveFull(finalVolume);
    }
  };

  const getArrowColorClass = (val: string) => {
    if (val === "X" || val === "10" || val === "9") return "bg-yellow-gold text-black border-yellow-gold/30";
    if (val === "8" || val === "7") return "bg-red-500 text-white border-red-500/30";
    if (val === "6" || val === "5") return "bg-blue-500 text-white border-blue-500/30";
    if (val === "4" || val === "3") return "bg-neutral-900 border-neutral-700 text-white";
    if (val === "M") return "bg-red-rival text-white border-red-rival/30";
    if (val === "") return "bg-transparent border-gray-border text-transparent";
    return "bg-white text-black border-white/20"; // 1-2 rings
  };

  return (
    <div className="flex flex-col gap-4 py-4 min-h-full">
      {/* Top Config info Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsExitModalOpen(true)}
            className="p-2 rounded-xl bg-neutral-900 border border-gray-border text-gray-dim hover:text-white cursor-pointer"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h3 className="text-white text-sm font-black uppercase tracking-wide">
              {config.format} · {config.distance}m
            </h3>
            <p className="text-[10px] text-gray-dim uppercase tracking-wider">
              {config.practiceType} · {config.bowType}
            </p>
          </div>
        </div>

        {/* Tab Selection Mode buttons */}
        <div className="flex bg-neutral-900 p-0.5 rounded-full border border-gray-border">
          <button
            onClick={() => setMode("TARGET")}
            className={`p-2 rounded-full cursor-pointer transition ${
              mode === "TARGET" ? "bg-cyan-neon/10 text-cyan-neon" : "text-gray-dim hover:text-white"
            }`}
          >
            <Target size={16} />
          </button>
          <button
            onClick={() => setMode("KEYBOARD")}
            className={`p-2 rounded-full cursor-pointer transition ${
              mode === "KEYBOARD" ? "bg-cyan-neon/10 text-cyan-neon" : "text-gray-dim hover:text-white"
            }`}
          >
            <Keyboard size={16} />
          </button>
        </div>
      </div>

      {/* Floating clock controller integration */}
      <FloatingClock
        onClockDisabledChange={setClockDisabled}
        onTimeUpdate={(timeStr, phase, isOver, isWarn) => {
          setClockTimeStr(timeStr);
          setClockPhase(phase);
          setClockIsOver(isOver);
          setClockIsWarn(isWarn);
        }}
      />

      {/* Mini Clock display widget (visible when floating clock is running and overlay minimized) */}
      {clockTimeStr && (
        <div className="w-full bg-neutral-900/80 backdrop-blur border border-gray-border rounded-xl px-4 py-2 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-green-success animate-ping" />
            <span className="text-xs text-gray-dim font-bold uppercase tracking-wider">
              {clockPhase === "prep" ? t("phasePrep") : t("phaseShoot")}
            </span>
          </div>
          <span
            className={`text-lg font-black font-mono leading-none ${
              clockIsOver ? "text-red-rival" : clockIsWarn ? "text-yellow-gold" : "text-white"
            }`}
          >
            {clockTimeStr}
          </span>
        </div>
      )}

      {/* Total score box */}
      <div className="bg-neutral-900/40 border border-white/5 rounded-2xl p-4 flex justify-between items-center flex-wrap gap-2">
        <div className="flex flex-col">
          <span className="text-[10px] text-gray-dim font-bold tracking-widest uppercase">
            Puntuación
          </span>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-white leading-tight">
              {calculateTotalScore()} <span className="text-xs text-gray-dim">/ {config.maxScore}</span>
            </span>
            {isBlockFormat && currentEndIdx >= Math.floor(config.endsCount / 2) && (
              <button
                onClick={handleFinishFirstBlockOnly}
                className="text-[9px] font-black uppercase text-yellow-gold border border-yellow-gold/30 bg-yellow-gold/5 px-2.5 py-1 rounded-lg hover:bg-yellow-gold/15 transition cursor-pointer animate-pulse"
              >
                Finalizar en 1er Bloque
              </button>
            )}
          </div>
        </div>
        <div className="text-right flex flex-col items-end">
          <span className="text-[10px] text-cyan-neon font-black tracking-wider uppercase bg-cyan-neon/10 px-2 py-0.5 rounded-full border border-cyan-neon/20">
            End {currentEndIdx + 1} / {config.endsCount}
          </span>
          <span className="text-xs text-gray-dim font-bold mt-1">
            Flecha {currentArrowIdx + 1} / {config.arrowsPerEnd}
          </span>
        </div>
      </div>

      {/* SCORING COMPONENT MODES */}
      <div className="flex-1 flex flex-col justify-center min-h-[300px]">
        {mode === "TARGET" ? (
          // TARGET MODE (Diana SVG)
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex justify-center items-center py-2 relative">
              {/* Zoom Button to enlarge target */}
              <button
                onClick={() => setIsZoomed(true)}
                className="absolute top-2 right-6 p-2 rounded-xl bg-neutral-900 border border-neutral-800 text-cyan-neon hover:text-white cursor-pointer z-10 shadow-lg"
                title="Agrandar Diana para Precisión"
              >
                <Maximize2 size={16} />
              </button>

              <div className="relative">
                <svg
                  ref={dianaRef}
                  onMouseDown={(e) => handleStartDrag(e, false)}
                  onMouseMove={(e) => handleDrag(e, false)}
                  onMouseUp={handleEndDrag}
                  onTouchStart={(e) => handleStartDrag(e, false)}
                  onTouchMove={(e) => handleDrag(e, false)}
                  onTouchEnd={handleEndDrag}
                  viewBox="0 0 100 100"
                  className="w-full max-w-[260px] aspect-square rounded-full border-4 border-neutral-900 shadow-2xl bg-black cursor-crosshair overflow-visible relative"
                >
                  {/* SVG Concetriques rings rings */}
                  <circle cx="50" cy="50" r="48" className="fill-white stroke-neutral-200 stroke-[0.2]" />
                  <circle cx="50" cy="50" r="43.2" className="fill-white stroke-neutral-200 stroke-[0.2]" />
                  <circle cx="50" cy="50" r="38.4" className="fill-black stroke-neutral-700 stroke-[0.2]" />
                  <circle cx="50" cy="50" r="33.6" className="fill-black stroke-neutral-700 stroke-[0.2]" />
                  <circle cx="50" cy="50" r="28.8" className="fill-[#1E88E5] stroke-[#1565C0] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="24" className="fill-[#1E88E5] stroke-[#1565C0] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="19.2" className="fill-[#E53935] stroke-[#C62828] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="14.4" className="fill-[#E53935] stroke-[#C62828] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="9.6" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="4.8" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="1.5" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.15]" />
                  
                  {/* Render coordinate markers on the diana SVG */}
                  {impacts
                    .filter((imp) => imp.endIdx === currentEndIdx)
                    .map((imp, idx) => (
                      <g key={idx}>
                        {/* Connection line to center */}
                        <line
                          x1={imp.x}
                          y1={imp.y}
                          x2="50"
                          y2="50"
                          stroke="#FFF200"
                          strokeWidth="0.4"
                          strokeDasharray="1 1"
                          opacity="0.6"
                        />
                        {/* Bullet point */}
                        <circle cx={imp.x} cy={imp.y} r="1.6" className="fill-yellow-gold stroke-black stroke-[0.4px] shadow-lg" />
                        {/* Small text with index */}
                        <text
                          x={imp.x}
                          y={imp.y + 0.65}
                          textAnchor="middle"
                          fontSize="1.6"
                          fontWeight="bold"
                          fill="black"
                        >
                          {imp.arrowIdx + 1}
                        </text>
                      </g>
                    ))}

                  {/* Render temporal drag marker */}
                  {tempImpact && (
                    <g className="animate-pulse">
                      <line
                        x1={tempImpact.x}
                        y1={tempImpact.y}
                        x2="50"
                        y2="50"
                        stroke="#00E5FF"
                        strokeWidth="0.4"
                        strokeDasharray="1 1"
                        opacity="0.8"
                      />
                      <circle
                        cx={tempImpact.x}
                        cy={tempImpact.y}
                        r="3"
                        fill="none"
                        stroke="#00E5FF"
                        strokeWidth="0.4"
                      />
                      <circle
                        cx={tempImpact.x}
                        cy={tempImpact.y}
                        r="1.6"
                        className="fill-cyan-neon stroke-black stroke-[0.4px] shadow-lg"
                      />
                      <text
                        x={tempImpact.x}
                        y={tempImpact.y + 0.65}
                        textAnchor="middle"
                        fontSize="1.6"
                        fontWeight="black"
                        fill="black"
                      >
                        {currentArrowIdx + 1}
                      </text>
                    </g>
                  )}
                </svg>

                {/* Precision Magnifier (Lupa flotante estilo iOS) */}
                {isDraggingTarget && tempImpact && (
                  <div className="absolute top-[-90px] left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 bg-neutral-950/95 backdrop-blur-md p-1.5 rounded-full border border-cyan-neon shadow-2xl">
                    <svg
                      viewBox={`${tempImpact.x - 12} ${tempImpact.y - 12} 24 24`}
                      className="w-20 h-20 rounded-full bg-black overflow-hidden pointer-events-none"
                    >
                      <circle cx="50" cy="50" r="48" className="fill-white stroke-neutral-200 stroke-[0.1]" />
                      <circle cx="50" cy="50" r="43.2" className="fill-white stroke-neutral-200 stroke-[0.1]" />
                      <circle cx="50" cy="50" r="38.4" className="fill-black stroke-neutral-700 stroke-[0.1]" />
                      <circle cx="50" cy="50" r="33.6" className="fill-black stroke-neutral-700 stroke-[0.1]" />
                      <circle cx="50" cy="50" r="28.8" className="fill-[#1E88E5] stroke-[#1565C0] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="24" className="fill-[#1E88E5] stroke-[#1565C0] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="19.2" className="fill-[#E53935] stroke-[#C62828] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="14.4" className="fill-[#E53935] stroke-[#C62828] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="9.6" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="4.8" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="1.5" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.1]" />
                      
                      <circle cx={tempImpact.x} cy={tempImpact.y} r="0.8" fill="#00E5FF" stroke="black" strokeWidth="0.2" />
                      <line x1={tempImpact.x} y1={tempImpact.y} x2="50" y2="50" stroke="#00E5FF" strokeWidth="0.1" strokeDasharray="0.3 0.3" />
                    </svg>
                    <span className="text-[9px] text-cyan-neon font-black tracking-widest uppercase px-1 leading-none mt-0.5">
                      {tempImpact.value}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons (Confirm, Undo & Miss) */}
            <div className="flex flex-col gap-2.5 px-4">
              {tempImpact && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={handleConfirmImpact}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider shadow-glow-cyan flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Target size={14} />
                  <span>Confirmar Impacto ({tempImpact.value})</span>
                </motion.button>
              )}
              <div className="flex justify-center items-center gap-3">
                <button
                  onClick={handleBackspace}
                  disabled={currentEndIdx === 0 && currentArrowIdx === 0 && (!ends[0] || ends[0].arrows[0] === "")}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 bg-neutral-900 text-gray-dim font-bold text-xs uppercase cursor-pointer hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <Undo2 size={13} />
                  <span>Deshacer</span>
                </button>
                <button
                  onClick={() => {
                    setTempImpact(null);
                    handleScoreInput("M");
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-red-rival/30 bg-red-rival/5 text-red-rival font-bold text-xs uppercase cursor-pointer hover:bg-red-rival/10 transition"
                >
                  Fallo (Miss)
                </button>
              </div>
            </div>
          </div>
        ) : (
          // KEYBOARD MODE (tactile grid cells & 4x4 keypad)
          <div className="flex-1 flex flex-col gap-3 justify-between">
            {/* Table view Grid row (with max-height and auto-scroll container ref) */}
            <div
              ref={tableContainerRef}
              className="w-full overflow-y-auto border border-gray-border/40 rounded-xl bg-neutral-950/40 max-h-[160px]"
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-neutral-900 text-gray-dim font-bold uppercase text-[9px] tracking-wider border-b border-gray-border/40">
                    <th className="py-2 px-3 text-center">End</th>
                    <th className="py-2 px-3 text-center">Flechas</th>
                    <th className="py-2 px-3 text-center">Total</th>
                    <th className="py-2 px-3 text-center">Acum</th>
                  </tr>
                </thead>
                <tbody>
                  {ends.map((e, idx) => {
                    const isCurrent = currentEndIdx === idx;
                    const halfEnds = Math.floor(config.endsCount / 2);
                    
                    return (
                      <React.Fragment key={idx}>
                        {isBlockFormat && idx === halfEnds && (
                          <tr className="bg-neutral-900/80 border-y border-cyan-neon/20">
                            <td colSpan={4} className="py-1.5 px-3 text-center text-[9px] font-black text-cyan-neon tracking-widest uppercase">
                              --- Bloque 2 (Segunda Mitad) ---
                            </td>
                          </tr>
                        )}
                        <tr
                          data-active={isCurrent}
                          className={`border-b border-gray-border/20 transition ${
                            isCurrent ? "bg-cyan-brand/5" : ""
                          }`}
                        >
                        <td className="py-2 px-3 font-bold text-center text-gray-dim">{idx + 1}</td>
                        <td className="py-2 px-3 flex items-center justify-center gap-1">
                          {e.arrows.map((a, arrowIdx) => {
                            const isCellEditing = isCurrent && currentArrowIdx === arrowIdx;
                            
                            // Dynamic font class to satisfy font size requirements without layout overflow
                            const textFontClass = fontSize === "large" ? "text-base" : fontSize === "xlarge" ? "text-lg" : "text-sm";
                            
                            return (
                              <div
                                key={arrowIdx}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold border transition-all ${textFontClass} ${getArrowColorClass(
                                  a
                                )} ${
                                  isCellEditing
                                    ? "border-cyan-neon ring-1 ring-cyan-neon shadow-glow-cyan bg-cyan-neon/5"
                                    : ""
                                }`}
                              >
                                {a}
                              </div>
                            );
                          })}
                        </td>
                        <td className="py-2 px-3 text-center font-extrabold text-white">
                          {calculateEndTotal(idx)}
                        </td>
                        <td className="py-2 px-3 text-center font-extrabold text-gray-dim">
                          {calculateRunningTotal(idx)}
                        </td>
                      </tr>
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Keypad Buttons 4x4 */}
            <div className="grid grid-cols-4 gap-2 mt-2">
              {/* Max points */}
              {["X", "10", "9"].map((key) => (
                <button
                  key={key}
                  onClick={() => handleScoreInput(key)}
                  className="py-3 rounded-xl border-2 border-yellow-gold text-yellow-gold font-extrabold text-sm flex items-center justify-center cursor-pointer shadow-[0_0_10px_rgba(255,242,0,0.15)] hover:bg-yellow-gold/10 active:scale-95 transition"
                >
                  {key}
                </button>
              ))}
              {/* Backspace */}
              <button
                onClick={handleBackspace}
                className="py-3 rounded-xl border border-gray-border bg-neutral-900 text-gray-dim font-bold text-sm flex items-center justify-center cursor-pointer hover:text-white hover:bg-neutral-850 active:scale-95 transition"
              >
                ⌫
              </button>

              {/* Standard points 8-5 */}
              {["8", "7", "6", "5"].map((key) => (
                <button
                  key={key}
                  onClick={() => handleScoreInput(key)}
                  className="py-3 rounded-xl border border-cyan-brand/60 text-white font-bold text-sm flex items-center justify-center cursor-pointer hover:border-cyan-neon hover:bg-cyan-neon/5 active:scale-95 transition"
                >
                  {key}
                </button>
              ))}

              {/* Standard points 4-1 */}
              {["4", "3", "2", "1"].map((key) => (
                <button
                  key={key}
                  onClick={() => handleScoreInput(key)}
                  className="py-3 rounded-xl border border-cyan-brand/60 text-white font-bold text-sm flex items-center justify-center cursor-pointer hover:border-cyan-neon hover:bg-cyan-neon/5 active:scale-95 transition"
                >
                  {key}
                </button>
              ))}

              {/* Miss */}
              <button
                onClick={() => handleScoreInput("M")}
                className="col-span-2 py-3 rounded-xl border border-red-rival/40 text-red-rival font-extrabold text-xs flex items-center justify-center uppercase cursor-pointer hover:bg-red-rival/10 active:scale-95 transition"
              >
                Miss (M)
              </button>

              {/* Confirm Round/End */}
              <button
                onClick={handleConfirmEnd}
                className="col-span-2 py-3 rounded-xl bg-gradient-to-br from-cyan-brand to-cyan-neon text-black font-extrabold text-xs flex items-center justify-center uppercase cursor-pointer shadow-glow-cyan hover:brightness-110 active:scale-95 transition"
              >
                <span>Confirmar End</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* End Note expansion (during the session) */}
      {config.includeNotes && currentEndIdx < config.endsCount && (
        <div className="flex flex-col gap-1.5 mt-2 bg-neutral-900/30 p-3.5 rounded-2xl border border-white/5">
          <div className="flex items-center gap-1.5 text-xs text-gray-dim font-bold uppercase tracking-wider">
            <MessageSquare size={13} className="text-cyan-neon" />
            <span>Nota del End {currentEndIdx + 1}</span>
          </div>
          <textarea
            value={endNote}
            onChange={(e) => setEndNote(e.target.value)}
            placeholder={t("endNotePlaceholder")}
            className="w-full bg-neutral-950/60 border border-gray-border focus:border-cyan-neon text-white text-xs p-2.5 rounded-xl outline-none transition-all duration-200 resize-none h-14"
          />
        </div>
      )}

      {/* Quick navigation bottom options for manual confirms */}
      {mode === "TARGET" && (
        <div className="flex justify-between items-center gap-4 mt-4">
          <button
            onClick={() => {
              setTempImpact(null);
              handleBackspace();
            }}
            className="flex-1 py-3 rounded-xl border border-gray-border text-gray-dim font-bold text-xs flex items-center justify-center gap-1 hover:text-white transition cursor-pointer"
          >
            <span>Retroceder</span>
          </button>
          <button
            onClick={() => {
              setTempImpact(null);
              handleConfirmEnd();
            }}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-glow-cyan cursor-pointer"
          >
            <span>Confirmar End</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* MODAL: Post-session Summary Notes (Final Save screen) */}
      <AnimatePresence>
        {isFinishing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 15 }}
              className="w-full max-w-sm bg-neutral-900 border border-gray-border p-6 rounded-3xl flex flex-col gap-5 shadow-2xl text-left"
            >
              <div>
                <h3 className="text-white text-lg font-black uppercase tracking-wide">
                  Terminar Entrenamiento
                </h3>
                <p className="text-xs text-gray-dim mt-0.5">
                  Resumen de sesión y notas finales
                </p>
              </div>

              {/* Summary Stats box */}
              <div className="bg-neutral-950/60 p-4 rounded-2xl border border-white/5 grid grid-cols-2 gap-3 text-center">
                <div>
                  <span className="text-[9px] text-gray-dim uppercase font-bold">Score Total</span>
                  <p className="text-2xl font-black text-cyan-neon mt-0.5">
                    {calculateTotalScore()}
                  </p>
                </div>
                <div>
                  <span className="text-[9px] text-gray-dim uppercase font-bold">Precisión</span>
                  <p className="text-2xl font-black text-yellow-gold mt-0.5">
                    {Math.round((calculateTotalScore() / config.maxScore) * 100)}%
                  </p>
                </div>
              </div>

              {/* Bloques y Fatiga report (para WA600/720) */}
              {isBlockFormat && (
                <div className="bg-neutral-950/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-2 text-xs">
                  <span className="text-[9px] text-gray-dim uppercase font-bold">Rendimiento por Bloques</span>
                  <div className="flex justify-between text-white/80">
                    <span>Bloque 1 (Mitad 1):</span>
                    <span className="font-extrabold text-cyan-neon">
                      {ends.slice(0, Math.floor(config.endsCount / 2)).reduce((sum, e) => sum + e.arrows.reduce((s, a) => s + getScoreValue(a), 0), 0)} pts
                    </span>
                  </div>
                  <div className="flex justify-between text-white/80">
                    <span>Bloque 2 (Mitad 2):</span>
                    <span className="font-extrabold text-cyan-neon">
                      {ends.slice(Math.floor(config.endsCount / 2)).reduce((sum, e) => sum + e.arrows.reduce((s, a) => s + getScoreValue(a), 0), 0)} pts
                    </span>
                  </div>
                  {(() => {
                    const b1 = ends.slice(0, Math.floor(config.endsCount / 2)).reduce((sum, e) => sum + e.arrows.reduce((s, a) => s + getScoreValue(a), 0), 0);
                    const b2 = ends.slice(Math.floor(config.endsCount / 2)).reduce((sum, e) => sum + e.arrows.reduce((s, a) => s + getScoreValue(a), 0), 0);
                    const diff = b2 - b1;
                    return (
                      <div className="flex justify-between border-t border-white/5 pt-1.5 mt-0.5">
                        <span>Consistencia:</span>
                        <span className={`font-black uppercase text-[10px] ${diff < 0 ? "text-red-500" : "text-cyan-neon"}`}>
                          {diff > 0 ? `+${diff}` : diff} pts {diff < 0 ? "(Fatiga)" : "(Excelente)"}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Textarea post-session notes */}
              {config.includeNotes && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim font-bold uppercase tracking-wider">
                    Notas de la Sesión
                  </label>
                  <textarea
                    value={sessionNote}
                    onChange={(e) => setSessionNote(e.target.value)}
                    placeholder={t("sessionNotePlaceholder")}
                    className="w-full bg-neutral-950/60 border border-cyan-brand focus:border-cyan-neon text-white text-xs p-3.5 rounded-2xl outline-none transition duration-200 min-h-[100px] resize-none caret-yellow-gold"
                  />
                  <p className="text-[9px] text-gray-dim">Estas notas se guardan en tu historial y son visibles para el Coach.</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-2.5 mt-2">
                <button
                  onClick={handleFinishAndSave}
                  className="w-full py-3.5 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-yellow-gold font-black text-xs uppercase tracking-wider shadow-glow-cyan flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save size={15} />
                  <span>Guardar Entrenamiento</span>
                </button>
                <button
                  onClick={() => setIsFinishing(false)}
                  className="w-full py-3.5 rounded-full bg-transparent border border-gray-border text-gray-dim hover:text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Seguir Tirando
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: Diana SVG Zoom Mode */}
      <AnimatePresence>
        {isZoomed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-6"
          >
            {/* Close Zoom button */}
            <button
              onClick={() => setIsZoomed(false)}
              className="absolute top-6 right-6 py-2 px-4 rounded-xl bg-neutral-900 border border-neutral-800 text-gray-dim hover:text-white font-bold text-xs uppercase cursor-pointer"
            >
              Cerrar Zoom ✕
            </button>
            
            <div className="flex flex-col items-center gap-4 text-center w-full">
              <span className="text-[10px] text-cyan-neon font-black tracking-widest uppercase bg-cyan-neon/10 px-2 py-0.5 rounded-full border border-cyan-neon/20">
                Zoom Diana de Precisión
              </span>
              <p className="text-[10px] text-gray-dim leading-none">
                End {currentEndIdx + 1} · Flecha {currentArrowIdx + 1} de {config.arrowsPerEnd}
              </p>
              {/* Zoomed Target SVG */}
              <div className="relative">
                <svg
                  ref={zoomedDianaRef}
                  onMouseDown={(e) => handleStartDrag(e, true)}
                  onMouseMove={(e) => handleDrag(e, true)}
                  onMouseUp={handleEndDrag}
                  onTouchStart={(e) => handleStartDrag(e, true)}
                  onTouchMove={(e) => handleDrag(e, true)}
                  onTouchEnd={handleEndDrag}
                  viewBox="0 0 100 100"
                  className="w-full max-w-[320px] aspect-square rounded-full border-4 border-neutral-900 shadow-2xl bg-black cursor-crosshair overflow-visible relative"
                >
                  <circle cx="50" cy="50" r="48" className="fill-white stroke-neutral-200 stroke-[0.2]" />
                  <circle cx="50" cy="50" r="43.2" className="fill-white stroke-neutral-200 stroke-[0.2]" />
                  <circle cx="50" cy="50" r="38.4" className="fill-black stroke-neutral-700 stroke-[0.2]" />
                  <circle cx="50" cy="50" r="33.6" className="fill-black stroke-neutral-700 stroke-[0.2]" />
                  <circle cx="50" cy="50" r="28.8" className="fill-[#1E88E5] stroke-[#1565C0] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="24" className="fill-[#1E88E5] stroke-[#1565C0] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="19.2" className="fill-[#E53935] stroke-[#C62828] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="14.4" className="fill-[#E53935] stroke-[#C62828] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="9.6" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="4.8" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.2]" />
                  <circle cx="50" cy="50" r="1.5" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.15]" />
                  
                  {impacts
                    .filter((imp) => imp.endIdx === currentEndIdx)
                    .map((imp, idx) => (
                      <g key={idx}>
                        <line x1={imp.x} y1={imp.y} x2="50" y2="50" stroke="#FFF200" strokeWidth="0.4" strokeDasharray="1 1" opacity="0.6" />
                        <circle cx={imp.x} cy={imp.y} r="1.6" className="fill-yellow-gold stroke-black stroke-[0.4px] shadow-lg" />
                        <text x={imp.x} y={imp.y + 0.65} textAnchor="middle" fontSize="1.6" fontWeight="bold" fill="black">
                          {imp.arrowIdx + 1}
                        </text>
                      </g>
                    ))}

                  {/* Render temporal drag marker */}
                  {tempImpact && (
                    <g className="animate-pulse">
                      <line x1={tempImpact.x} y1={tempImpact.y} x2="50" y2="50" stroke="#00E5FF" strokeWidth="0.4" strokeDasharray="1 1" opacity="0.8" />
                      <circle cx={tempImpact.x} cy={tempImpact.y} r="3" fill="none" stroke="#00E5FF" strokeWidth="0.4" />
                      <circle cx={tempImpact.x} cy={tempImpact.y} r="1.6" className="fill-cyan-neon stroke-black stroke-[0.4px] shadow-lg" />
                      <text x={tempImpact.x} y={tempImpact.y + 0.65} textAnchor="middle" fontSize="1.6" fontWeight="black" fill="black">
                        {currentArrowIdx + 1}
                      </text>
                    </g>
                  )}
                </svg>

                {/* Zoom Magnifier overlay */}
                {isDraggingTarget && tempImpact && (
                  <div className="absolute top-[-90px] left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 bg-neutral-950/95 backdrop-blur-md p-1.5 rounded-full border border-cyan-neon shadow-2xl">
                    <svg
                      viewBox={`${tempImpact.x - 12} ${tempImpact.y - 12} 24 24`}
                      className="w-20 h-20 rounded-full bg-black overflow-hidden pointer-events-none"
                    >
                      <circle cx="50" cy="50" r="48" className="fill-white stroke-neutral-200 stroke-[0.1]" />
                      <circle cx="50" cy="50" r="43.2" className="fill-white stroke-neutral-200 stroke-[0.1]" />
                      <circle cx="50" cy="50" r="38.4" className="fill-black stroke-neutral-700 stroke-[0.1]" />
                      <circle cx="50" cy="50" r="33.6" className="fill-black stroke-neutral-700 stroke-[0.1]" />
                      <circle cx="50" cy="50" r="28.8" className="fill-[#1E88E5] stroke-[#1565C0] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="24" className="fill-[#1E88E5] stroke-[#1565C0] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="19.2" className="fill-[#E53935] stroke-[#C62828] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="14.4" className="fill-[#E53935] stroke-[#C62828] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="9.6" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="4.8" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.1]" />
                      <circle cx="50" cy="50" r="1.5" className="fill-[#FDD835] stroke-[#F57F17] stroke-[0.1]" />
                      
                      <circle cx={tempImpact.x} cy={tempImpact.y} r="0.8" fill="#00E5FF" stroke="black" strokeWidth="0.2" />
                      <line x1={tempImpact.x} y1={tempImpact.y} x2="50" y2="50" stroke="#00E5FF" strokeWidth="0.1" strokeDasharray="0.3 0.3" />
                    </svg>
                    <span className="text-[9px] text-cyan-neon font-black tracking-widest uppercase px-1 leading-none mt-0.5">
                      {tempImpact.value}
                    </span>
                  </div>
                )}
              </div>
              
              <div className="flex flex-col gap-2.5 mt-2 w-full max-w-[320px]">
                {tempImpact && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={handleConfirmImpact}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider shadow-glow-cyan flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Target size={14} />
                    <span>Confirmar Impacto ({tempImpact.value})</span>
                  </motion.button>
                )}
                
                <div className="flex gap-2">
                  <button
                    onClick={handleBackspace}
                    disabled={currentEndIdx === 0 && currentArrowIdx === 0 && (!ends[0] || ends[0].arrows[0] === "")}
                    className="flex-1 py-2.5 rounded-xl border border-white/10 bg-neutral-900 text-gray-dim font-bold text-xs uppercase cursor-pointer hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Deshacer
                  </button>
                  <button
                    onClick={() => {
                      setTempImpact(null);
                      handleScoreInput("M");
                    }}
                    className="flex-1 py-2.5 rounded-xl border border-red-rival/30 bg-red-rival/5 text-red-rival font-bold text-xs uppercase cursor-pointer hover:bg-red-rival/10 transition"
                  >
                    Registrar Miss
                  </button>
                </div>
              </div>         </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: Exit / Pause Session Dialog */}
      <AnimatePresence>
        {isExitModalOpen && (
          <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-xs flex flex-col gap-4 text-center">
              <h3 className="text-white text-base font-black uppercase">¿Pausar Sesión?</h3>
              <p className="text-xs text-gray-dim">
                Puedes guardar el progreso actual como borrador para reanudarlo más tarde, o descartar la sesión por completo.
              </p>
              
              <div className="flex flex-col gap-2.5 mt-2">
                <button
                  onClick={handleSaveDraft}
                  className="w-full py-3 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider shadow-glow-cyan cursor-pointer"
                >
                  Pausar & Guardar Borrador
                </button>
                <button
                  onClick={handleDiscard}
                  className="w-full py-3 rounded-full bg-red-rival/20 border border-red-rival/35 text-red-rival font-bold text-xs uppercase cursor-pointer hover:bg-red-rival/30 transition"
                >
                  Descartar Entrenamiento
                </button>
                <button
                  onClick={() => setIsExitModalOpen(false)}
                  className="w-full py-3 rounded-full bg-transparent border border-gray-border text-gray-dim hover:text-white font-bold text-xs uppercase cursor-pointer"
                >
                  Seguir Tirando
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Confirm Carga Total de Volumen */}
      <AnimatePresence>
        {isConfirmingVolume && (
          <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-xs flex flex-col gap-4 text-center">
              <div>
                <span className="text-[10px] text-cyan-neon font-black tracking-widest uppercase">
                  Control de Carga Física
                </span>
                <h3 className="text-white text-base font-black uppercase mt-1">
                  Confirmar Volumen Total
                </h3>
              </div>

              <p className="text-xs text-gray-dim leading-relaxed">
                Has registrado tiros en planilla y calentamiento. Confirma la cantidad exacta de flechas tiradas hoy para tus estadísticas de volumen:
              </p>

              <div className="flex items-center justify-center bg-neutral-950 border border-neutral-800 rounded-2xl py-3 px-4 mt-2">
                <button
                  type="button"
                  onClick={() => setConfirmedVolume(Math.max(0, confirmedVolume - 3))}
                  className="px-3.5 py-1.5 text-cyan-neon font-black text-lg cursor-pointer active:scale-95 hover:bg-neutral-900 rounded-lg"
                >
                  -3
                </button>
                <input
                  type="number"
                  value={confirmedVolume}
                  onChange={(e) => setConfirmedVolume(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-20 text-center font-black text-white text-2xl bg-transparent outline-none border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => setConfirmedVolume(confirmedVolume + 3)}
                  className="px-3.5 py-1.5 text-cyan-neon font-black text-lg cursor-pointer active:scale-95 hover:bg-neutral-900 rounded-lg"
                >
                  +3
                </button>
              </div>

              <div className="flex flex-col gap-2 mt-4">
                <button
                  onClick={() => executeFinalSave(confirmedVolume)}
                  className="w-full py-3.5 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider shadow-glow-cyan cursor-pointer"
                >
                  Confirmar y Guardar
                </button>
                <button
                  onClick={() => setIsConfirmingVolume(false)}
                  className="w-full py-3 rounded-full bg-transparent border border-gray-border text-gray-dim hover:text-white font-bold text-xs uppercase cursor-pointer"
                >
                  Regresar
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
