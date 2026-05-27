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

  // Exit & Zoom states
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [fontSize, setFontSize] = useState("normal");

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
    // Go back and clear cell
    let targetArrow = currentArrowIdx;
    let targetEnd = currentEndIdx;

    if (currentArrowIdx > 0) {
      targetArrow = currentArrowIdx - 1;
    } else if (currentEndIdx > 0) {
      targetEnd = currentEndIdx - 1;
      targetArrow = config.arrowsPerEnd - 1;
    } else {
      return; // already at first cell
    }

    setCurrentEndIdx(targetEnd);
    setCurrentArrowIdx(targetArrow);

    setEnds((prevEnds) => {
      const newEnds = [...prevEnds];
      const end = { ...newEnds[targetEnd] };
      const arrows = [...end.arrows];
      
      // Clear corresponding impact if in Diana mode
      setImpacts((prev) => prev.filter((imp) => !(imp.endIdx === targetEnd && imp.arrowIdx === targetArrow)));

      arrows[targetArrow] = "";
      end.arrows = arrows;
      newEnds[targetEnd] = end;
      return newEnds;
    });
  };

  // Diana SVG Tap coordinate conversion with Zoom option
  const handleDianaTouch = (e: React.MouseEvent<SVGSVGElement>, fromZoom = false) => {
    if (currentEndIdx >= config.endsCount) return;

    // Check if current end is already full of arrows
    const currentArrows = ends[currentEndIdx]?.arrows || [];
    const actualShots = currentArrows.filter(a => a !== "").length;
    if (actualShots >= config.arrowsPerEnd) {
      alert("Este End ya está completo. Confírmalo para pasar al siguiente.");
      return;
    }

    const svg = fromZoom ? zoomedDianaRef.current : dianaRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const touchX = e.clientX - rect.left;
    const touchY = e.clientY - rect.top;

    // Convert to relative coordinate percentages
    const pctX = (touchX / rect.width) * 100;
    const pctY = (touchY / rect.height) * 100;

    // Compute distance from center of circle (50, 50)
    const dx = pctX - 50;
    const dy = pctY - 50;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Map radial distance (radius out of 50%) to World Archery scoring zones
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

    // Save impact marker coordinates
    const newImpact: ShotImpact = {
      endIdx: currentEndIdx,
      arrowIdx: currentArrowIdx,
      x: pctX,
      y: pctY,
      value
    };

    setImpacts((prev) => [...prev, newImpact]);
    handleScoreInput(value);
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

  const handleFinishAndSave = async () => {
    const finalScore = calculateTotalScore();
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
      format: config.format,
      endsCount: config.endsCount,
      arrowsPerEnd: config.arrowsPerEnd,
      maxScore: config.maxScore,
      score: finalScore,
      ends: ends,
      sessionNote: sessionNote,
      impacts: impacts
    };

    try {
      // 1. Delete draft if it was restored
      if (config.draftId) {
        await deleteLocalSession(config.draftId);
      }

      // 2. Save local sychronously (IndexedDB zero latency)
      await saveLocalSession(sessionId, sessionObj);

      // 2. Queue cloud insertion to firestore
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "sessions",
        operation: "INSERT",
        payloadId: sessionId,
        payload: sessionObj,
        timestamp: Date.now()
      });

      // CONFETTI CELEBRATION!
      confetti({
        particleCount: 120,
        spread: 60,
        origin: { y: 0.8 },
        colors: ["#00E5FF", "#FFF200", "#FF3B30", "#00C853"]
      });

      // 3. Flush queue asynchronously (background sync)
      runSync();

      onSessionSaved();
    } catch (err) {
      console.error("Failed to save session", err);
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
      <div className="bg-neutral-900/40 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
        <div className="flex flex-col">
          <span className="text-[10px] text-gray-dim font-bold tracking-widest uppercase">
            Puntuación
          </span>
          <span className="text-2xl font-black text-white leading-tight">
            {calculateTotalScore()} <span className="text-xs text-gray-dim">/ {config.maxScore}</span>
          </span>
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

              <svg
                ref={dianaRef}
                onClick={(e) => handleDianaTouch(e)}
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
              </svg>
            </div>

            {/* Action buttons (Undo & Miss) */}
            <div className="flex justify-center items-center gap-3">
              <button
                onClick={handleBackspace}
                disabled={currentEndIdx === 0 && currentArrowIdx === 0 && (!ends[0] || ends[0].arrows[0] === "")}
                className="py-2.5 px-6 rounded-xl border border-white/10 bg-neutral-900 text-gray-dim font-bold text-xs uppercase cursor-pointer hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Undo2 size={13} />
                <span>Deshacer</span>
              </button>
              <button
                onClick={() => handleScoreInput("M")}
                className="py-2.5 px-6 rounded-xl border border-red-rival/30 bg-red-rival/5 text-red-rival font-bold text-xs uppercase cursor-pointer hover:bg-red-rival/10 transition"
              >
                Fallo (Miss)
              </button>
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
                    
                    return (
                      <tr
                        key={idx}
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
            onClick={handleBackspace}
            className="flex-1 py-3 rounded-xl border border-gray-border text-gray-dim font-bold text-xs flex items-center justify-center gap-1 hover:text-white transition cursor-pointer"
          >
            <span>Retroceder</span>
          </button>
          <button
            onClick={handleConfirmEnd}
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
              <svg
                ref={zoomedDianaRef}
                onClick={(e) => handleDianaTouch(e, true)}
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
              </svg>
              
              <div className="flex gap-2">
                <button
                  onClick={handleBackspace}
                  disabled={currentEndIdx === 0 && currentArrowIdx === 0 && (!ends[0] || ends[0].arrows[0] === "")}
                  className="py-2.5 px-4 rounded-xl border border-white/10 bg-neutral-900 text-gray-dim font-bold text-xs uppercase cursor-pointer hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Deshacer
                </button>
                <button
                  onClick={() => handleScoreInput("M")}
                  className="py-2.5 px-4 rounded-xl border border-red-rival/30 bg-red-rival/5 text-red-rival font-bold text-xs uppercase cursor-pointer hover:bg-red-rival/10 transition"
                >
                  Registrar Miss
                </button>
              </div>
            </div>
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
    </div>
  );
}
