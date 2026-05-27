"use client";

import React, { useState, useEffect, useRef } from "react";
import { UserProfile } from "@/lib/authService";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, RotateCcw, Check, Sparkles, AlertCircle, HelpCircle } from "lucide-react";
import { saveLocalSession, generateResilientId } from "@/lib/db/indexedDB";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import confetti from "canvas-confetti";

const COUNTRIES = [
  { code: "CR", name: "Costa Rica", flag: "🇨🇷" },
  { code: "ES", name: "España", flag: "🇪🇸" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "US", name: "United States", flag: "🇺🇸" }
];

interface MatchplayGameViewProps {
  user: UserProfile;
  config: any; // { id, bowType, distance, system, rival: { uid, fullName, country, clubName, clubLogo, clubCountry, rating } }
  onBack: () => void;
  onDuelSaved: () => void;
}

export default function MatchplayGameView({ user, config, onBack, onDuelSaved }: MatchplayGameViewProps) {
  const isCompound = config.system === "cumulative";
  
  // Game states
  const [currentEnd, setCurrentEnd] = useState(0);
  const [currentArrow, setCurrentArrow] = useState(0); // 0, 1, 2
  const [userTiros, setUserTiros] = useState<number[][]>([[], [], [], [], []]);
  const [rivalTiros, setRivalTiros] = useState<number[][]>([[], [], [], [], []]);
  
  const [userSetPoints, setUserSetPoints] = useState(0);
  const [rivalSetPoints, setRivalSetPoints] = useState(0);

  // Shoot-off states
  const [isShootOff, setIsShootOff] = useState(false);
  const [userShootOffShot, setUserShootOffShot] = useState<number | null>(null);
  const [rivalShootOffShot, setRivalShootOffShot] = useState<number | null>(null);
  
  // UX states
  const [rivalThinking, setRivalThinking] = useState(false);
  const [duelFinished, setDuelFinished] = useState(false);
  const [winner, setWinner] = useState<"USER" | "RIVAL" | "TIE" | null>(null);
  const [endSummary, setEndSummary] = useState<string | null>(null);

  // Diana dragging states
  const [cursorPos, setCursorPos] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const targetRef = useRef<SVGSVGElement | null>(null);
  const [zoomCirclePos, setZoomCirclePos] = useState({ x: 0, y: 0 });

  // Pre-selected color palette
  const userColor = "cyan-neon";
  const rivalColor = "red-rival";

  // Animation variants
  const containerVariants: any = {
    initial: { opacity: 0 },
    animate: { opacity: 1 }
  };

  const popVariants: any = {
    initial: { scale: 0.9, opacity: 0 },
    animate: { scale: 1, opacity: 1, transition: { type: "spring", stiffness: 300, damping: 20 } }
  };

  // Convert coordinate on SVG Diana to score
  const calculateScoreFromCoords = (x: number, y: number): number => {
    const dx = x - 100;
    const dy = y - 100;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Radii of ring zones (diameter is 200, radius is 100)
    // 10 ring: <= 9
    // 9 ring: <= 18
    // 8 ring: <= 27
    // 7 ring: <= 36
    // 6 ring: <= 45
    // 5 ring: <= 54
    // 4 ring: <= 63
    // 3 ring: <= 72
    // 2 ring: <= 81
    // 1 ring: <= 90
    // Miss: > 90

    if (distance <= 4.5) return 10; // X10 inner
    if (distance <= 9) return 10;
    if (distance <= 18) return 9;
    if (distance <= 27) return 8;
    if (distance <= 36) return 7;
    if (distance <= 45) return 6;
    if (distance <= 54) return 5;
    if (distance <= 63) return 4;
    if (distance <= 72) return 3;
    if (distance <= 81) return 2;
    if (distance <= 90) return 1;
    return 0; // Miss
  };

  // Handle Dragging Target
  const handleTargetTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (!targetRef.current || rivalThinking || duelFinished) return;
    setIsDragging(true);
    updateCursorPos(e);
  };

  const handleTargetTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging || !targetRef.current) return;
    updateCursorPos(e);
  };

  const handleTargetTouchEnd = () => {
    setIsDragging(false);
  };

  const updateCursorPos = (e: React.TouchEvent | React.MouseEvent) => {
    if (!targetRef.current) return;
    const rect = targetRef.current.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Relative SVG coords (100, 100 is center, size is 200)
    const relativeX = ((clientX - rect.left) / rect.width) * 200;
    const relativeY = ((clientY - rect.top) / rect.height) * 200;

    // Limit radius to Diana border
    const dx = relativeX - 100;
    const dy = relativeY - 100;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= 98) {
      setCursorPos({ x: relativeX, y: relativeY });
      setZoomCirclePos({ x: clientX - rect.left, y: clientY - rect.top });
    } else {
      // Projected coordinates on target border
      const angle = Math.atan2(dy, dx);
      setCursorPos({
        x: 100 + Math.cos(angle) * 98,
        y: 100 + Math.sin(angle) * 98
      });
      setZoomCirclePos({
        x: (rect.width / 2) + Math.cos(angle) * (rect.width / 2) * 0.98,
        y: (rect.height / 2) + Math.sin(angle) * (rect.height / 2) * 0.98
      });
    }
  };

  // Undo last shot of the current end
  const handleUndo = () => {
    if (rivalThinking || duelFinished) return;

    if (isShootOff) {
      setUserShootOffShot(null);
      return;
    }

    // Find current active arrow index
    const shotsCount = userTiros[currentEnd].length;
    if (shotsCount === 0) return;

    // Remove last shot
    const updatedTiros = [...userTiros];
    updatedTiros[currentEnd] = updatedTiros[currentEnd].slice(0, -1);
    setUserTiros(updatedTiros);
    setCurrentArrow(shotsCount - 1);

    // Also remove the rival's corresponding shot
    const updatedRivalTiros = [...rivalTiros];
    if (updatedRivalTiros[currentEnd].length > updatedTiros[currentEnd].length) {
      updatedRivalTiros[currentEnd] = updatedRivalTiros[currentEnd].slice(0, updatedTiros[currentEnd].length);
      setRivalTiros(updatedRivalTiros);
    }
  };

  // Confirm arrow score
  const handleConfirmShot = () => {
    if (rivalThinking || duelFinished) return;

    const score = calculateScoreFromCoords(cursorPos.x, cursorPos.y);

    if (isShootOff) {
      setUserShootOffShot(score);
      simulateRivalShootOff();
      return;
    }

    const updatedTiros = [...userTiros];
    const currentEndShots = [...updatedTiros[currentEnd], score];
    updatedTiros[currentEnd] = currentEndShots;
    setUserTiros(updatedTiros);

    // Advance user arrow
    const nextArrow = currentArrow + 1;
    setCurrentArrow(nextArrow);

    // Trigger simulated rival shot
    simulateRivalShot(nextArrow, currentEndShots);
  };

  // Simulate rival shoot-off arrow
  const simulateRivalShootOff = () => {
    setRivalThinking(true);
    setTimeout(() => {
      // Simulate shot based on rating
      const rand = Math.random();
      let score = 9;
      if (config.rival.rating >= 9.3) {
        score = rand > 0.4 ? 10 : rand > 0.05 ? 9 : 8;
      } else {
        score = rand > 0.6 ? 10 : rand > 0.2 ? 9 : rand > 0.05 ? 8 : 7;
      }
      setRivalShootOffShot(score);
      setRivalThinking(false);
    }, 1800);
  };

  // Check shoot-off winner
  useEffect(() => {
    if (isShootOff && userShootOffShot !== null && rivalShootOffShot !== null) {
      setTimeout(() => {
        if (userShootOffShot > rivalShootOffShot) {
          setWinner("USER");
          setDuelFinished(true);
          triggerConfetti();
        } else if (rivalShootOffShot > userShootOffShot) {
          setWinner("RIVAL");
          setDuelFinished(true);
        } else {
          // Double tie in shoot-off, shoot again
          alert("¡Empate en flecha de desempate! Se dispara otra flecha.");
          setUserShootOffShot(null);
          setRivalShootOffShot(null);
        }
      }, 800);
    }
  }, [isShootOff, userShootOffShot, rivalShootOffShot]);

  // Simulate rival shot
  const simulateRivalShot = (nextArrow: number, userEndShots: number[]) => {
    setRivalThinking(true);
    
    // Simulate thinking duration
    const delay = 1200 + Math.random() * 1200;
    setTimeout(() => {
      const updatedRival = [...rivalTiros];
      
      // Calculate probability based on rival skill rating
      const ratingVal = config.rival.rating; // e.g. 9.4
      const rand = Math.random();
      
      let rivalScore = 9;
      if (ratingVal >= 9.4) {
        rivalScore = rand > 0.45 ? 10 : rand > 0.08 ? 9 : 8;
      } else if (ratingVal >= 9.0) {
        rivalScore = rand > 0.65 ? 10 : rand > 0.25 ? 9 : rand > 0.05 ? 8 : 7;
      } else {
        rivalScore = rand > 0.8 ? 10 : rand > 0.45 ? 9 : rand > 0.15 ? 8 : 7;
      }

      updatedRival[currentEnd] = [...updatedRival[currentEnd], rivalScore];
      setRivalTiros(updatedRival);
      setRivalThinking(false);

      // Check if end is complete (3 arrows each)
      if (nextArrow === 3) {
        evaluateEndCompletion(userEndShots, updatedRival[currentEnd]);
      }
    }, delay);
  };

  const evaluateEndCompletion = (userEndShots: number[], rivalEndShots: number[]) => {
    const userSum = userEndShots.reduce((a, b) => a + b, 0);
    const rivalSum = rivalEndShots.reduce((a, b) => a + b, 0);

    let summaryMsg = "";
    
    if (isCompound) {
      // Cumulative compound logic
      if (userSum > rivalSum) {
        summaryMsg = `¡Ganaste la ronda! +${userSum} a +${rivalSum}`;
      } else if (rivalSum > userSum) {
        summaryMsg = `El rival ganó la ronda. +${rivalSum} a +${userSum}`;
      } else {
        summaryMsg = `Ronda empatada a ${userSum} puntos`;
      }
    } else {
      // Set recurve logic
      if (userSum > rivalSum) {
        setUserSetPoints((prev) => prev + 2);
        summaryMsg = `¡Ganaste el Set! +2 Pts (Tus tiros: ${userSum} vs ${rivalSum})`;
      } else if (rivalSum > userSum) {
        setRivalSetPoints((prev) => prev + 2);
        summaryMsg = `Set para el rival. +2 Pts (Tus tiros: ${userSum} vs ${rivalSum})`;
      } else {
        setUserSetPoints((prev) => prev + 1);
        setRivalSetPoints((prev) => prev + 1);
        summaryMsg = `Set empatado. +1 Pt cada uno (${userSum} vs ${rivalSum})`;
      }
    }

    setEndSummary(summaryMsg);
  };

  // Evaluate set/match winner after points update
  useEffect(() => {
    if (endSummary === null) return;

    // Check if match ended
    const nextEnd = currentEnd + 1;
    let matchOver = false;
    let finalWinner: "USER" | "RIVAL" | "TIE" | null = null;

    if (isCompound) {
      if (nextEnd === 5) {
        matchOver = true;
        const userTotal = getCumulativeTotal(userTiros);
        const rivalTotal = getCumulativeTotal(rivalTiros);
        
        if (userTotal > rivalTotal) {
          finalWinner = "USER";
        } else if (rivalTotal > userTotal) {
          finalWinner = "RIVAL";
        } else {
          finalWinner = "TIE";
        }
      }
    } else {
      // Set System (first to 6 wins)
      if (userSetPoints >= 6 && userSetPoints > rivalSetPoints) {
        matchOver = true;
        finalWinner = "USER";
      } else if (rivalSetPoints >= 6 && rivalSetPoints > userSetPoints) {
        matchOver = true;
        finalWinner = "RIVAL";
      } else if (nextEnd === 5) {
        // Max 5 sets, if no one has 6 points or it's a tie
        if (userSetPoints === rivalSetPoints) {
          finalWinner = "TIE";
        } else if (userSetPoints > rivalSetPoints) {
          matchOver = true;
          finalWinner = "USER";
        } else {
          matchOver = true;
          finalWinner = "RIVAL";
        }
      }
    }

    if (matchOver) {
      if (finalWinner === "TIE") {
        setIsShootOff(true);
        setEndSummary("¡Match empatado! Vamos a flecha de desempate (Shoot-off).");
      } else {
        setWinner(finalWinner);
        setDuelFinished(true);
        if (finalWinner === "USER") triggerConfetti();
      }
    }
  }, [userSetPoints, rivalSetPoints, endSummary]);

  const handleNextEnd = () => {
    setEndSummary(null);
    setCurrentEnd((prev) => prev + 1);
    setCurrentArrow(0);
  };

  const getCumulativeTotal = (tiros: number[][]): number => {
    return tiros.reduce((sum, end) => sum + end.reduce((a, b) => a + b, 0), 0);
  };

  const triggerConfetti = () => {
    confetti({
      particleCount: 120,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  // Save duel session and update local volume
  const handleSaveAndExit = async () => {
    // Generate arrows quantity
    const totalUserArrows = userTiros.flat().length + (userShootOffShot !== null ? 1 : 0);
    const userTotalScore = userTiros.flat().reduce((a, b) => a + b, 0) + (userShootOffShot || 0);

    const duelId = config.id || generateResilientId("DUE");

    const newSession = {
      uid: duelId,
      userUid: user.uid,
      userName: user.fullName,
      timestamp: Date.now(),
      practiceType: "Control", // count as control/volume practice
      bowConfig: { type: config.bowType, brand: user.bowConfig.brand, model: user.bowConfig.model, poundage: user.bowConfig.poundage },
      endsCount: userTiros.filter(e => e.length > 0).length,
      arrowsPerEnd: 3,
      distance: config.distance,
      score: userTotalScore,
      maxScore: userTiros.filter(e => e.length > 0).length * 30 + (userShootOffShot !== null ? 10 : 0),
      warmupArrows: 0,
      isDuel: true,
      opponent: config.rival.fullName,
      opponentCountry: config.rival.country,
      opponentClubName: config.rival.clubName,
      opponentClubLogo: config.rival.clubLogo,
      outcome: winner === "USER" ? "win" : winner === "RIVAL" ? "loss" : "tie"
    };

    try {
      await saveLocalSession(duelId, newSession);
      onDuelSaved();
    } catch (e) {
      console.error("Error saving duel session", e);
      onDuelSaved();
    }
  };

  const currentRivalName = config.rival.fullName;
  const currentRivalFlag = COUNTRIES.find(c => c.code === config.rival.country)?.flag || "🇲🇽";

  return (
    <div className="flex flex-col gap-4 py-3 min-h-full relative overflow-hidden select-none">
      
      {/* Background neon dynamic blobs */}
      <div className="absolute top-[-10%] left-[-15%] w-[70%] aspect-square rounded-full bg-purple-500/10 blur-[100px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-15%] w-[70%] aspect-square rounded-full bg-cyan-neon/10 blur-[100px] pointer-events-none z-0" />

      {/* Arena Header Status bar */}
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-2 z-10">
        <button
          onClick={onBack}
          disabled={rivalThinking || (currentEnd > 0 && !duelFinished)}
          className={`p-2 rounded-xl bg-neutral-900/60 backdrop-blur-md border border-white/10 text-gray-dim hover:text-white transition ${
            rivalThinking || (currentEnd > 0 && !duelFinished) ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[10px] text-purple-400 font-black tracking-widest uppercase">
          {isShootOff ? "Flecha Desempate" : `Set ${currentEnd + 1} de 5`}
        </span>
        <div className="w-8" />
      </div>

      {/* Duelist panels and live scoreboard */}
      <div className="bg-neutral-900/60 backdrop-blur-md border border-white/10 rounded-3xl p-4 flex flex-col gap-3.5 z-10 relative overflow-hidden">
        
        {/* Score grid */}
        <div className="grid grid-cols-5 items-center gap-1">
          {/* Athlete (User) Panel */}
          <div className="col-span-2 flex flex-col items-center gap-1.5 text-center">
            <div className="w-10 h-10 rounded-full bg-cyan-neon/10 border border-cyan-neon/30 flex items-center justify-center text-cyan-neon font-black text-xs shadow-glow-cyan">
              {user.fullName.substring(0, 2).toUpperCase()}
            </div>
            <span className="text-[11px] text-white font-extrabold truncate max-w-[85px]">
              Tú ({config.bowType})
            </span>
          </div>

          {/* Central score digits */}
          <div className="col-span-1 flex flex-col items-center justify-center">
            {isCompound ? (
              // Cumulative points compound score
              <div className="flex justify-center items-baseline gap-1 bg-black/40 px-3 py-1.5 rounded-xl border border-white/5">
                <span className="text-xl font-black text-cyan-neon">
                  {getCumulativeTotal(userTiros) + (userShootOffShot || 0)}
                </span>
                <span className="text-[9px] text-gray-dim font-bold">-</span>
                <span className="text-xl font-black text-red-rival">
                  {getCumulativeTotal(rivalTiros) + (rivalShootOffShot || 0)}
                </span>
              </div>
            ) : (
              // Set recurve set system score
              <div className="flex justify-center items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-white/5">
                <span className="text-2xl font-black text-cyan-neon text-glow-cyan">
                  {userSetPoints}
                </span>
                <span className="text-[10px] text-gray-dim font-bold">:</span>
                <span className="text-2xl font-black text-red-rival text-glow-red">
                  {rivalSetPoints}
                </span>
              </div>
            )}
            <span className="text-[8px] text-gray-dim font-bold uppercase tracking-wider mt-1.5">
              {isCompound ? "Total Pts" : "Sets"}
            </span>
          </div>

          {/* Rival Panel */}
          <div className="col-span-2 flex flex-col items-center gap-1.5 text-center">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-red-rival/10 border border-red-rival/30 flex items-center justify-center text-red-rival font-black text-xs shadow-glow-red">
                {currentRivalName.substring(0, 2).toUpperCase()}
              </div>
              <span className="absolute bottom-0 right-0 text-[10px]">{currentRivalFlag}</span>
            </div>
            <span className="text-[11px] text-white font-extrabold truncate max-w-[85px]">
              {currentRivalName}
            </span>
          </div>
        </div>

        {/* Shoot-off shot visual markers */}
        {isShootOff && (
          <div className="border-t border-white/[0.03] pt-3 grid grid-cols-2 gap-4 text-center">
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[8px] text-gray-dim font-black uppercase">Tu Desempate</span>
              <span className="text-xl font-black text-cyan-neon">
                {userShootOffShot !== null ? userShootOffShot : "—"}
              </span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[8px] text-gray-dim font-black uppercase">Rival Desempate</span>
              <span className="text-xl font-black text-red-rival">
                {rivalThinking ? (
                  <span className="inline-block animate-pulse text-[10px] text-purple-400">Apuntando...</span>
                ) : rivalShootOffShot !== null ? (
                  rivalShootOffShot
                ) : (
                  "—"
                )}
              </span>
            </div>
          </div>
        )}

        {/* Live arrow-by-arrow scoring list for current end */}
        {!isShootOff && (
          <div className="border-t border-white/[0.03] pt-3 flex flex-col gap-2">
            <span className="text-[8px] text-gray-dim font-black uppercase tracking-wider text-center">
              Flechas End Actual
            </span>
            <div className="grid grid-cols-2 gap-6">
              {/* User shots */}
              <div className="flex justify-end gap-1.5">
                {[0, 1, 2].map((idx) => {
                  const val = userTiros[currentEnd][idx];
                  return (
                    <div
                      key={idx}
                      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-black ${
                        val !== undefined
                          ? "bg-cyan-neon/10 border-cyan-neon/40 text-cyan-neon shadow-glow-cyan"
                          : "bg-neutral-950/40 border-white/5 text-gray-600"
                      }`}
                    >
                      {val !== undefined ? val : ""}
                    </div>
                  );
                })}
              </div>

              {/* Rival shots */}
              <div className="flex justify-start gap-1.5">
                {[0, 1, 2].map((idx) => {
                  const val = rivalTiros[currentEnd][idx];
                  const isLoading = idx === userTiros[currentEnd].length - 1 && rivalThinking;
                  return (
                    <div
                      key={idx}
                      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-black ${
                        val !== undefined
                          ? "bg-red-rival/10 border-red-rival/40 text-red-rival shadow-glow-red"
                          : isLoading
                          ? "border-purple-400 animate-spin bg-purple-500/5 [animation-duration:3s]"
                          : "bg-neutral-950/40 border-white/5 text-gray-600"
                      }`}
                    >
                      {val !== undefined ? (
                        val
                      ) : isLoading ? (
                        <span className="text-[6px] animate-pulse">●</span>
                      ) : (
                        ""
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Target Arena (Diana & Drag cursor) */}
      {!duelFinished && (
        <div className="flex-1 flex flex-col justify-center items-center gap-3 z-10">
          
          {/* Zoom coordinate info & value */}
          <div className="flex gap-4 items-center justify-center bg-black/40 px-4 py-1.5 rounded-full border border-white/5 text-[10px] font-bold">
            <span className="text-gray-dim">Puntuación Estimada:</span>
            <span className="text-yellow-gold font-extrabold text-xs">
              🎯 {calculateScoreFromCoords(cursorPos.x, cursorPos.y)} Ptos
            </span>
          </div>

          {/* Interactive target SVG */}
          <div className="relative w-full max-w-[250px] aspect-square bg-neutral-950/30 rounded-full border border-white/5 flex items-center justify-center shadow-2xl overflow-visible">
            
            <svg
              ref={targetRef}
              viewBox="0 0 200 200"
              className="w-full h-full cursor-crosshair select-none"
              onMouseDown={handleTargetTouchStart}
              onMouseMove={handleTargetTouchMove}
              onMouseUp={handleTargetTouchEnd}
              onTouchStart={handleTargetTouchStart}
              onTouchMove={handleTargetTouchMove}
              onTouchEnd={handleTargetTouchEnd}
            >
              {/* White rings (1 y 2) */}
              <circle cx="100" cy="100" r="90" fill="#FFFFFF" stroke="#000000" strokeWidth="0.5" />
              <circle cx="100" cy="100" r="81" fill="#FFFFFF" stroke="#000000" strokeWidth="0.5" />
              
              {/* Black rings (3 y 4) */}
              <circle cx="100" cy="100" r="72" fill="#000000" stroke="#FFFFFF" strokeWidth="0.5" />
              <circle cx="100" cy="100" r="63" fill="#000000" stroke="#FFFFFF" strokeWidth="0.5" />
              
              {/* Blue rings (5 y 6) */}
              <circle cx="100" cy="100" r="54" fill="#00E5FF" stroke="#000000" strokeWidth="0.5" />
              <circle cx="100" cy="100" r="45" fill="#00E5FF" stroke="#000000" strokeWidth="0.5" />
              
              {/* Red rings (7 y 8) */}
              <circle cx="100" cy="100" r="36" fill="#FF1E27" stroke="#000000" strokeWidth="0.5" />
              <circle cx="100" cy="100" r="27" fill="#FF1E27" stroke="#000000" strokeWidth="0.5" />
              
              {/* Gold rings (9, 10 y X10) */}
              <circle cx="100" cy="100" r="18" fill="#FFF200" stroke="#000000" strokeWidth="0.5" />
              <circle cx="100" cy="100" r="9" fill="#FFF200" stroke="#000000" strokeWidth="0.5" />
              <circle cx="100" cy="100" r="4.5" fill="#FFF200" stroke="#000000" strokeWidth="0.3" />

              {/* Cursor Point */}
              <circle
                cx={cursorPos.x}
                cy={cursorPos.y}
                r="3"
                className="fill-purple-400 stroke-white stroke-[0.8px] shadow-glow-purple pointer-events-none"
              />
              
              {/* Crosshair on cursor */}
              <line x1={cursorPos.x - 6} y1={cursorPos.y} x2={cursorPos.x + 6} y2={cursorPos.y} stroke="white" strokeWidth="0.5" />
              <line x1={cursorPos.x} y1={cursorPos.y - 6} x2={cursorPos.x} y2={cursorPos.y + 6} stroke="white" strokeWidth="0.5" />
            </svg>

            {/* Target precision magnification magnifying glass */}
            {isDragging && (
              <div
                className="absolute w-14 h-14 rounded-full border border-purple-400 bg-neutral-900 pointer-events-none overflow-hidden flex items-center justify-center shadow-2xl z-20"
                style={{
                  left: `${zoomCirclePos.x - 28}px`,
                  top: `${zoomCirclePos.y - 68}px`,
                }}
              >
                {/* Simulated zoom representation */}
                <div 
                  className="w-28 h-28 scale-150 relative"
                  style={{
                    transform: `translate(${-cursorPos.x * 0.7 + 14}px, ${-cursorPos.y * 0.7 + 14}px) scale(2)`
                  }}
                >
                  <div className="w-14 h-14 rounded-full bg-[#FFF200] border border-black absolute left-[43%] top-[43%]" />
                  <div className="w-4 h-4 rounded-full bg-purple-400 absolute" style={{ left: `${cursorPos.x * 0.5}%`, top: `${cursorPos.y * 0.5}%` }} />
                </div>
                {/* Center dot indicator */}
                <div className="absolute w-1.5 h-1.5 rounded-full bg-purple-400 border border-white" />
              </div>
            )}
          </div>

          <span className="text-[8px] text-gray-dim font-bold uppercase text-center mt-1">
            Arrastra el dedo sobre la diana para apuntar con precisión
          </span>
        </div>
      )}

      {/* Action Buttons (Confirm & Undo) */}
      {!duelFinished && (
        <div className="flex gap-3 px-1 z-10 mt-auto">
          {/* Undo Button */}
          <button
            onClick={handleUndo}
            disabled={
              rivalThinking || 
              (isShootOff && userShootOffShot === null) || 
              (!isShootOff && userTiros[currentEnd].length === 0)
            }
            className="w-16 h-12 rounded-2xl bg-neutral-900 border border-white/5 text-gray-dim hover:text-red-rival flex items-center justify-center cursor-pointer transition disabled:opacity-20 disabled:cursor-not-allowed"
            title="Deshacer Tiro"
          >
            <RotateCcw size={16} />
          </button>

          {/* Confirm Button */}
          <button
            onClick={handleConfirmShot}
            disabled={
              rivalThinking || 
              (isShootOff && userShootOffShot !== null) || 
              (!isShootOff && userTiros[currentEnd].length === 3)
            }
            className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(168,85,247,0.15)] cursor-pointer hover:brightness-105 active:scale-98 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Check size={14} />
            <span>Confirmar Flecha</span>
          </button>
        </div>
      )}

      {/* End Complete popup card overlay */}
      <AnimatePresence>
        {endSummary && !duelFinished && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-5"
          >
            <motion.div
              variants={popVariants}
              initial="initial"
              animate="animate"
              exit="initial"
              className="w-full max-w-[320px] bg-neutral-950 border border-purple-500/25 p-5 rounded-[32px] flex flex-col items-center text-center gap-4 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />
              <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <Sparkles size={20} />
              </div>
              <h3 className="text-white text-xs font-black uppercase tracking-wider">
                Fin del Set {currentEnd + 1}
              </h3>
              <p className="text-xs text-gray-dim leading-relaxed px-1">
                {endSummary}
              </p>
              <button
                onClick={handleNextEnd}
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs uppercase tracking-wider cursor-pointer active:scale-95 transition"
              >
                Siguiente Set
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Finished Duel Screen */}
      <AnimatePresence>
        {duelFinished && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4"
          >
            <motion.div
              variants={popVariants}
              initial="initial"
              animate="animate"
              className="w-full max-w-[350px] bg-neutral-950 border border-purple-500/20 p-6 rounded-[36px] flex flex-col items-center text-center gap-5 shadow-2xl relative overflow-hidden"
            >
              {/* Glowing header line */}
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-purple-500 via-pink-500 to-red-500" />

              <div className="w-16 h-16 rounded-full bg-neutral-900 border border-purple-500/30 flex items-center justify-center text-3xl shadow-[0_0_20px_rgba(168,85,247,0.15)] mt-2">
                {winner === "USER" ? "🏆" : winner === "RIVAL" ? "💔" : "🤝"}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-purple-400 font-black uppercase tracking-widest leading-none">
                  Fin del Duelo de Eliminación
                </span>
                <h3 className="text-white text-xl font-black uppercase tracking-wide mt-1">
                  {winner === "USER" ? "¡Victoria Magistral!" : winner === "RIVAL" ? "Derrota" : "Empate Final"}
                </h3>
                <p className="text-[11px] text-gray-dim leading-relaxed px-2 mt-1">
                  {winner === "USER" 
                    ? `Has vencido a ${config.rival.fullName} de ${config.rival.clubName}. ¡Gran desempeño!`
                    : winner === "RIVAL"
                    ? `${config.rival.fullName} ha tomado la victoria. ¡Sigue entrenando para la revancha!`
                    : "Un encuentro reñido que concluye en empate."}
                </p>
              </div>

              {/* Match summary points */}
              <div className="w-full bg-neutral-900/60 rounded-2xl border border-white/5 p-4 flex flex-col gap-2 mt-1">
                <div className="flex justify-between items-center text-xs py-1 border-b border-white/[0.03]">
                  <span className="text-gray-dim">Tu Puntuación Total:</span>
                  <span className="text-cyan-neon font-black">
                    {userTiros.flat().reduce((a, b) => a + b, 0)} pts
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs py-1 border-b border-white/[0.03]">
                  <span className="text-gray-dim">Puntuación Rival:</span>
                  <span className="text-red-rival font-black">
                    {rivalTiros.flat().reduce((a, b) => a + b, 0)} pts
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs py-1">
                  <span className="text-gray-dim">Volumen Sumado:</span>
                  <span className="text-yellow-gold font-black">
                    +{userTiros.flat().length + (userShootOffShot !== null ? 1 : 0)} flechas
                  </span>
                </div>
              </div>

              <button
                onClick={handleSaveAndExit}
                className="w-full py-3.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs uppercase tracking-wider cursor-pointer hover:brightness-105 active:scale-98 transition shadow-[0_0_20px_rgba(168,85,247,0.2)] text-center"
              >
                Guardar y Volver a Dashboard
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
