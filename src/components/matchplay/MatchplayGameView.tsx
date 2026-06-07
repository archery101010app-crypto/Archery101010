"use client";

import React, { useState, useEffect, useRef } from "react";
import { UserProfile } from "@/lib/authService";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, RotateCcw, HelpCircle, Sparkles, Trophy, Mic, MicOff, Volume2, Phone } from "lucide-react";
import { saveLocalSession, generateResilientId } from "@/lib/db/indexedDB";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import confetti from "canvas-confetti";
import { playWABeepStart, playWABeepWarning, playWABeepEnd, playRadioStatic } from "@/lib/soundUtils";

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
  config: any; // { id, bowType, distance, system, rival: { uid, fullName, country, clubName, clubLogo, clubCountry, rating }, ...draftsStates }
  onBack: () => void;
  onDuelSaved: () => void;
}

export interface ShotImpact {
  endIdx: number;
  arrowIdx: number;
  x: number;
  y: number;
  value: string;
}

const presetRings = [
  { r: 48, v: "1", fill: "#FFFFFF", stroke: "#E2E8F0" },
  { r: 43.2, v: "2", fill: "#FFFFFF", stroke: "#E2E8F0" },
  { r: 38.4, v: "3", fill: "#000000", stroke: "#404040" },
  { r: 33.6, v: "4", fill: "#000000", stroke: "#404040" },
  { r: 28.8, v: "5", fill: "#1E88E5", stroke: "#1565C0" },
  { r: 24, v: "6", fill: "#1E88E5", stroke: "#1565C0" },
  { r: 19.2, v: "7", fill: "#E53935", stroke: "#C62828" },
  { r: 14.4, v: "8", fill: "#E53935", stroke: "#C62828" },
  { r: 9.6, v: "9", fill: "#FDD835", stroke: "#F57F17" },
  { r: 4.8, v: "10", fill: "#FDD835", stroke: "#F57F17" },
  { r: 1.5, v: "X", fill: "#FDD835", stroke: "#F57F17" }
];

export default function MatchplayGameView({ user, config, onBack, onDuelSaved }: MatchplayGameViewProps) {
  const isCompound = config.system === "cumulative";
  
  // Game states (initialized from config in case of resuming a draft)
  const [currentEnd, setCurrentEnd] = useState<number>(config.currentEnd ?? 0);
  const [currentArrow, setCurrentArrow] = useState<number>(config.currentArrow ?? 0); // 0, 1, 2
  const [userTiros, setUserTiros] = useState<(string | number)[][]>(config.userTiros ?? [[], [], [], [], []]);
  const [rivalTiros, setRivalTiros] = useState<(string | number)[][]>(config.rivalTiros ?? [[], [], [], [], []]);
  const [userSetPoints, setUserSetPoints] = useState<number>(config.userSetPoints ?? 0);
  const [rivalSetPoints, setRivalSetPoints] = useState<number>(config.rivalSetPoints ?? 0);

  const [isShootOff, setIsShootOff] = useState<boolean>(config.isShootOff ?? false);
  const [userShootOffShot, setUserShootOffShot] = useState<number | null>(config.userShootOffShot ?? null);
  const [rivalShootOffShot, setRivalShootOffShot] = useState<number | null>(config.rivalShootOffShot ?? null);
  
  const [duelFinished, setDuelFinished] = useState<boolean>(config.duelFinished ?? false);
  const [winner, setWinner] = useState<"USER" | "RIVAL" | "TIE" | null>(config.winner ?? null);
  const [impacts, setImpacts] = useState<ShotImpact[]>(config.impacts ?? []);

  // Scoring input mode: TARGET (diana) vs KEYBOARD (teclado)
  const [mode, setMode] = useState<"TARGET" | "KEYBOARD">("TARGET");

  // Timer: 30s per user arrow
  const [timeLeft, setTimeLeft] = useState(30);

  // Photo Validation States
  const [validationPhase, setValidationPhase] = useState<"IDLE" | "UPLOAD" | "REVIEW">("IDLE");
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [rivalPhoto, setRivalPhoto] = useState<string | null>(null);
  const [endSummaryMsg, setEndSummaryMsg] = useState<string | null>(null);

  // General overlays
  const [showRules, setShowRules] = useState(!config.currentEnd);
  const [endSummary, setEndSummary] = useState<string | null>(null);

  // Ready Check States
  const [isReadyCheckActive, setIsReadyCheckActive] = useState<boolean>(true);
  const [isUserReady, setIsUserReady] = useState<boolean>(false);
  const [isRivalReady, setIsRivalReady] = useState<boolean>(false);
  const [readyCountdown, setReadyCountdown] = useState<number | null>(null);

  // Walkie-Talkie States
  const [isWalkieTalkieActive, setIsWalkieTalkieActive] = useState<boolean>(false);
  const [walkieWaveAnim, setWalkieWaveAnim] = useState<number[]>([10, 10, 10, 10]);
  const [isRivalSpeaking, setIsRivalSpeaking] = useState<boolean>(false);
  const [walkieText, setWalkieText] = useState<string | null>(null);
  const [microphoneAllowed, setMicrophoneAllowed] = useState<boolean>(false);

  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnimFrameId = useRef<number | null>(null);

  // UX animation and thinking states
  const [rivalThinking, setRivalThinking] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [isDianaZoomed, setIsDianaZoomed] = useState(false);
  
  // Magnifier (Lupa) tactile states
  const [lupaState, setLupaState] = useState({
    active: false,
    x: 50,
    y: 50,
    clientX: 0,
    clientY: 0,
    value: ""
  });

  const dianaRef = useRef<SVGSVGElement | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const estaScrolleandoRef = useRef(false);
  const lupaTimer = useRef<NodeJS.Timeout | null>(null);
  const lupaStateRef = useRef(lupaState);

  useEffect(() => {
    lupaStateRef.current = lupaState;
  }, [lupaState]);

  const popVariants: any = {
    initial: { scale: 0.9, opacity: 0 },
    animate: { scale: 1, opacity: 1, transition: { type: "spring", stiffness: 300, damping: 20 } }
  };

  // Turn Countdown Timer effect
  useEffect(() => {
    if (duelFinished || rivalThinking || endSummary || showRules || isShootOff || validationPhase !== "IDLE" || isReadyCheckActive) {
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Play 3 End Beeps (Señal de Alto WA)
          playWABeepEnd();
          // Auto register a Miss (M) on timer expiration
          handleScoreInput("M");
          return 30;
        }

        // Sound warning for last 5 seconds (5, 4, 3, 2, 1)
        const nextSec = prev - 1;
        if (nextSec <= 5 && nextSec > 0) {
          playWABeepWarning();
        }

        return nextSec;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [duelFinished, rivalThinking, endSummary, showRules, isShootOff, currentArrow, currentEnd, validationPhase, isReadyCheckActive]);

  // Reset timer on user's turn
  useEffect(() => {
    if (!rivalThinking && !duelFinished && !endSummary && !showRules && validationPhase === "IDLE" && !isReadyCheckActive) {
      setTimeLeft(30);
    }
  }, [rivalThinking, currentArrow, currentEnd, duelFinished, endSummary, showRules, validationPhase, isReadyCheckActive]);

  // Automated draft saving on state changes
  useEffect(() => {
    if (duelFinished) return;

    // Check if there are any shots entered to avoid saving empty drafts
    const hasShots = userTiros.some(end => end.length > 0) || rivalTiros.some(end => end.length > 0);
    if (!hasShots) return;

    const draftSession = {
      uid: config.id,
      userUid: user.uid,
      userName: user.fullName,
      timestamp: Date.now(),
      practiceType: "Control",
      bowConfig: { type: config.bowType, brand: user.bowConfig.brand, model: user.bowConfig.model, poundage: user.bowConfig.poundage },
      endsCount: userTiros.filter(e => e.length > 0).length,
      arrowsPerEnd: 3,
      distance: config.distance,
      score: userTiros.flat().reduce((sum: number, b) => sum + getValNumeric(b), 0) + (userShootOffShot || 0),
      maxScore: userTiros.filter(e => e.length > 0).length * 30 + (userShootOffShot !== null ? 10 : 0),
      warmupArrows: 0,
      isDuel: true,
      isDraft: true,
      opponent: config.rival.fullName,
      opponentCountry: config.rival.country,
      opponentClubName: config.rival.clubName,
      opponentClubLogo: config.rival.clubLogo,
      
      // Full game states for rehydration
      config: config,
      currentEnd,
      currentArrow,
      userTiros,
      rivalTiros,
      userSetPoints,
      rivalSetPoints,
      isShootOff,
      userShootOffShot,
      rivalShootOffShot,
      duelFinished,
      impacts
    };

    saveLocalSession(config.id, draftSession).catch((err) => {
      console.error("Error auto-saving duel draft:", err);
    });
  }, [
    userTiros,
    rivalTiros,
    currentEnd,
    currentArrow,
    userSetPoints,
    rivalSetPoints,
    isShootOff,
    userShootOffShot,
    rivalShootOffShot,
    duelFinished,
    impacts,
    user,
    config
  ]);

  // Rival Ready Simulation
  useEffect(() => {
    if (isReadyCheckActive && !isRivalReady && !duelFinished) {
      const delay = 800 + Math.random() * 1400;
      const timer = setTimeout(() => {
        setIsRivalReady(true);
        if (navigator.vibrate) {
          navigator.vibrate(15);
        }
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [isReadyCheckActive, isRivalReady, duelFinished]);

  // Countdown when both ready
  useEffect(() => {
    if (isReadyCheckActive && isUserReady && isRivalReady && !duelFinished) {
      setReadyCountdown(3);
    }
  }, [isReadyCheckActive, isUserReady, isRivalReady, duelFinished]);

  useEffect(() => {
    if (readyCountdown === null) return;

    if (readyCountdown > 0) {
      const timer = setTimeout(() => {
        setReadyCountdown(readyCountdown - 1);
        if (navigator.vibrate) {
          navigator.vibrate(20);
        }
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setIsReadyCheckActive(false);
      setReadyCountdown(null);
      // Play Olympic beep (1 beep starting the shot)!
      playWABeepStart();
      // Occasionally trigger oponent speech at the start of shot
      speakRivalPhraseOnTurnStart();
    }
  }, [readyCountdown]);

  // Walkie-Talkie mic handler
  const startMicrophoneAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      microphoneStreamRef.current = stream;
      setMicrophoneAllowed(true);

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      audioAnalyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateWave = () => {
        if (!audioAnalyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        
        const newWaves = Array.from(dataArray)
          .slice(0, 4)
          .map((v) => Math.max(10, Math.min(50, (v / 255) * 45 + 10)));
          
        setWalkieWaveAnim(newWaves.length ? newWaves : [10, 10, 10, 10]);
        micAnimFrameId.current = requestAnimationFrame(updateWave);
      };

      updateWave();
    } catch (e) {
      console.warn("Microphone access denied:", e);
      setMicrophoneAllowed(false);
      simulateStaticWave();
    }
  };

  const simulateStaticWave = () => {
    const update = () => {
      setWalkieWaveAnim([
        Math.random() * 20 + 10,
        Math.random() * 30 + 10,
        Math.random() * 25 + 10,
        Math.random() * 15 + 10
      ]);
      micAnimFrameId.current = requestAnimationFrame(update);
    };
    update();
  };

  const stopMicrophoneAnalysis = () => {
    if (micAnimFrameId.current) {
      cancelAnimationFrame(micAnimFrameId.current);
      micAnimFrameId.current = null;
    }
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
    }
    audioAnalyserRef.current = null;
    setWalkieWaveAnim([10, 10, 10, 10]);
  };

  useEffect(() => {
    if (isWalkieTalkieActive) {
      startMicrophoneAnalysis();
    } else {
      stopMicrophoneAnalysis();
    }
    return () => {
      stopMicrophoneAnalysis();
    };
  }, [isWalkieTalkieActive]);

  // Voice synthesis (Text-to-Speech)
  const speakRivalPhrase = (text: string) => {
    playRadioStatic();
    setWalkieText(text);
    setIsRivalSpeaking(true);

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "es-ES";
      
      const voices = window.speechSynthesis.getVoices();
      const isFemale = ["Daniela", "Laura"].some(n => config.rival.fullName.includes(n));
      const spanishVoices = voices.filter(v => v.lang.startsWith("es"));
      
      if (spanishVoices.length > 0) {
        const selectedVoice = spanishVoices.find(v => {
          const nameLower = v.name.toLowerCase();
          if (isFemale) {
            return nameLower.includes("sabina") || nameLower.includes("helena") || nameLower.includes("female") || nameLower.includes("mujer") || nameLower.includes("google");
          } else {
            return nameLower.includes("julio") || nameLower.includes("pablo") || nameLower.includes("male") || nameLower.includes("hombre");
          }
        }) || spanishVoices[0];
        utterance.voice = selectedVoice;
      }
      
      utterance.rate = 1.05;
      utterance.pitch = isFemale ? 1.15 : 0.95;
      
      utterance.onend = () => {
        setIsRivalSpeaking(false);
        playRadioStatic();
        setTimeout(() => setWalkieText(null), 2500);
      };
      
      utterance.onerror = () => {
        setIsRivalSpeaking(false);
        setTimeout(() => setWalkieText(null), 2500);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      setTimeout(() => {
        setIsRivalSpeaking(false);
        playRadioStatic();
        setTimeout(() => setWalkieText(null), 2500);
      }, 3000);
    }
  };

  const speakRivalPhraseOnTurnStart = () => {
    if (!isWalkieTalkieActive) return;
    if (Math.random() > 0.3) return; // 30% chance

    const phrases = [
      "¡Venga! A ver qué tal tiras esta flecha.",
      "Mucha concentración en esta línea.",
      "El viento está un poco inestable hoy, ¿eh?",
      "¡Buen tiro! Mantén el ritmo.",
      "Siento un poco de presión en la línea de tiro.",
      "Tu turno. ¡Apunta bien!"
    ];
    speakRivalPhrase(phrases[Math.floor(Math.random() * phrases.length)]);
  };

  const speakRivalPhraseOnShot = (score: number) => {
    if (!isWalkieTalkieActive) return;

    setTimeout(() => {
      if (score === 10) {
        const phrases = [
          "¡Impresionante! ¡Qué centro!",
          "¡Un diez perfecto! Qué gran tiro.",
          "Vaya tiro en el amarillo. Me pones presión.",
          "¡Bien hecho! Excelente ejecución."
        ];
        speakRivalPhrase(phrases[Math.floor(Math.random() * phrases.length)]);
      } else if (score <= 6) {
        const phrases = [
          "Una flecha difícil, el viento debió moverla.",
          "No te preocupes, el próximo tiro será mejor.",
          "Tranquilo, sacúdete ese tiro y concéntrate.",
          "Eso dolió, ¡recuperemos en la siguiente!"
        ];
        speakRivalPhrase(phrases[Math.floor(Math.random() * phrases.length)]);
      }
    }, 1000);
  };

  const speakRivalPhraseOnMatchEnd = (userWon: boolean | null) => {
    if (!isWalkieTalkieActive) return;

    setTimeout(() => {
      if (userWon === true) {
        speakRivalPhrase("¡Excelente duelo! Has tirado de maravilla. ¡Felicitaciones por la victoria!");
      } else if (userWon === false) {
        speakRivalPhrase("¡Qué buen enfrentamiento! Estuvo muy reñido de principio a fin. Buen juego.");
      } else {
        speakRivalPhrase("¡Un empate increíble! Vaya nivel de competencia.");
      }
    }, 1500);
  };

  // Helper values to parse string scores into numeric values
  const getValNumeric = (val: string | number): number => {
    if (val === "X" || val === 10) return 10;
    if (val === "M" || val === 0 || val === "") return 0;
    return Number(val);
  };

  // Convert coordinate on SVG target grid to score value
  const getCoordsFromClient = (clientX: number, clientY: number) => {
    const svgElement = dianaRef.current;
    if (!svgElement) return null;

    const rect = svgElement.getBoundingClientRect();
    const pctX = ((clientX - rect.left) / rect.width) * 100;
    const pctY = ((clientY - rect.top) / rect.height) * 100;

    // Clamp coordinates inside diana bounds (0 to 100)
    const clampedX = Math.max(0, Math.min(100, pctX));
    const clampedY = Math.max(0, Math.min(100, pctY));

    // Calculate score value based on distance from center (50, 50)
    const dx = clampedX - 50;
    const dy = clampedY - 50;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Find the corresponding ring
    const sortedRings = [...presetRings].sort((a, b) => a.r - b.r);
    const matchingRing = sortedRings.find((ring) => distance <= ring.r);
    const value = matchingRing ? matchingRing.v : "M";

    return { x: clampedX, y: clampedY, value };
  };

  // Calculate coordinates for keyboard values to plot them on target
  const getCoordinatesForScore = (val: string) => {
    // Offset Y coordinates relative to center (50, 50)
    if (val === "X") return { x: 50, y: 50 };
    if (val === "10") return { x: 50, y: 53 };
    if (val === "9") return { x: 50, y: 57 };
    if (val === "8") return { x: 50, y: 62 };
    if (val === "7") return { x: 50, y: 67 };
    if (val === "6") return { x: 50, y: 72 };
    if (val === "5") return { x: 50, y: 77 };
    if (val === "4") return { x: 50, y: 82 };
    if (val === "3") return { x: 50, y: 87 };
    if (val === "2") return { x: 50, y: 91 };
    if (val === "1") return { x: 50, y: 95 };
    return { x: 50, y: 99 }; // Miss (M)
  };

  // Attaches touch events for sliding magnifier zoom on target SVG
  useEffect(() => {
    const diana = dianaRef.current;
    if (!diana || mode !== "TARGET" || rivalThinking || duelFinished || validationPhase !== "IDLE") return;

    const onStart = (clientX: number, clientY: number) => {
      if (isShootOff && userShootOffShot !== null) return;
      if (!isShootOff && userTiros[currentEnd].length >= 3) return;

      touchStartX.current = clientX;
      touchStartY.current = clientY;
      estaScrolleandoRef.current = false;

      const coords = getCoordsFromClient(clientX, clientY);
      if (!coords) return;

      if (lupaTimer.current) clearTimeout(lupaTimer.current);

      lupaTimer.current = setTimeout(() => {
        if (!estaScrolleandoRef.current) {
          setLupaState({
            active: true,
            x: coords.x,
            y: coords.y,
            clientX,
            clientY,
            value: coords.value
          });
          if (navigator.vibrate) {
            navigator.vibrate(20);
          }
        }
      }, 220);
    };

    const onMove = (clientX: number, clientY: number, e: Event) => {
      const dx = clientX - touchStartX.current;
      const dy = clientY - touchStartY.current;

      if (!lupaStateRef.current.active && Math.sqrt(dx * dx + dy * dy) > 10) {
        estaScrolleandoRef.current = true;
        if (lupaTimer.current) {
          clearTimeout(lupaTimer.current);
          lupaTimer.current = null;
        }
      }

      if (lupaStateRef.current.active || lupaTimer.current) {
        if (e.cancelable) {
          e.preventDefault();
        }

        const coords = getCoordsFromClient(clientX, clientY);
        if (coords) {
          setLupaState(prev => {
            if (!prev.active) return prev;
            return {
              ...prev,
              x: coords.x,
              y: coords.y,
              clientX,
              clientY,
              value: coords.value
            };
          });
        }
      }
    };

    const onEnd = (clientX: number, clientY: number, e: Event) => {
      if (lupaTimer.current) {
        clearTimeout(lupaTimer.current);
        lupaTimer.current = null;
      }

      const active = lupaStateRef.current.active;
      const x = lupaStateRef.current.x;
      const y = lupaStateRef.current.y;
      const value = lupaStateRef.current.value;

      if (active) {
        registerShot(x, y, value);
        setLupaState({ active: false, x: 50, y: 50, clientX: 0, clientY: 0, value: "" });
        if (e.cancelable) e.preventDefault();
      } else if (!estaScrolleandoRef.current) {
        const coords = getCoordsFromClient(clientX, clientY);
        if (coords) {
          registerShot(coords.x, coords.y, coords.value);
        }
        if (e.cancelable) e.preventDefault();
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY, e);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0) return;
      onEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY, e);
    };

    const handleMouseDown = (e: MouseEvent) => {
      onStart(e.clientX, e.clientY);
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
      onMove(e.clientX, e.clientY, e);
    };

    const handleMouseUp = (e: MouseEvent) => {
      onEnd(e.clientX, e.clientY, e);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    diana.addEventListener("touchstart", handleTouchStart, { passive: false });
    diana.addEventListener("touchmove", handleTouchMove, { passive: false });
    diana.addEventListener("touchend", handleTouchEnd, { passive: false });
    diana.addEventListener("mousedown", handleMouseDown);

    return () => {
      diana.removeEventListener("touchstart", handleTouchStart);
      diana.removeEventListener("touchmove", handleTouchMove);
      diana.removeEventListener("touchend", handleTouchEnd);
      diana.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [mode, currentEnd, currentArrow, isShootOff, userShootOffShot, userTiros, rivalThinking, duelFinished, validationPhase]);

  const registerShot = (x: number, y: number, value: string) => {
    const numericValue = getValNumeric(value);

    // Save impact coordinates
    const newImpact: ShotImpact = {
      endIdx: currentEnd,
      arrowIdx: isShootOff ? 99 : userTiros[currentEnd].length,
      x,
      y,
      value
    };
    setImpacts((prev) => [...prev, newImpact]);
    
    // Speak on user shot
    speakRivalPhraseOnShot(numericValue);

    if (isShootOff) {
      setUserShootOffShot(numericValue);
      simulateRivalShootOff();
      return;
    }

    const updatedTiros = [...userTiros];
    const currentEndShots = [...updatedTiros[currentEnd], value];
    updatedTiros[currentEnd] = currentEndShots;
    setUserTiros(updatedTiros);

    // Advance user arrow
    const nextArrow = currentArrow + 1;
    setCurrentArrow(nextArrow);

    // Haptic vibration feedback
    if (navigator.vibrate) {
      navigator.vibrate(40);
    }

    // Trigger simulated rival shot
    simulateRivalShot(nextArrow, currentEndShots);
  };

  // Keyboard button click handler
  const handleScoreInput = (value: string) => {
    if (rivalThinking || duelFinished || validationPhase !== "IDLE") return;
    if (isShootOff && userShootOffShot !== null) return;
    if (!isShootOff && userTiros[currentEnd].length >= 3) return;

    const coords = getCoordinatesForScore(value);
    registerShot(coords.x, coords.y, value);
  };

  // Undo button / backspace key handler
  const handleUndo = () => {
    if (rivalThinking || duelFinished || validationPhase !== "IDLE") return;

    if (isShootOff) {
      setUserShootOffShot(null);
      return;
    }

    const shotsCount = userTiros[currentEnd].length;
    if (shotsCount === 0) return;

    // Remove last impact point
    setImpacts((prev) => prev.filter(imp => !(imp.endIdx === currentEnd && imp.arrowIdx === shotsCount - 1)));

    // Remove last shot
    const updatedTiros = [...userTiros];
    updatedTiros[currentEnd] = updatedTiros[currentEnd].slice(0, -1);
    setUserTiros(updatedTiros);
    setCurrentArrow(shotsCount - 1);

    // Also remove rival corresponding shot
    const updatedRivalTiros = [...rivalTiros];
    if (updatedRivalTiros[currentEnd].length > updatedTiros[currentEnd].length) {
      updatedRivalTiros[currentEnd] = updatedRivalTiros[currentEnd].slice(0, updatedTiros[currentEnd].length);
      setRivalTiros(updatedRivalTiros);
    }
  };

  const handleBackspace = () => {
    handleUndo();
  };

  // Calculate Centroid & Dispersion of user's active set impacts
  const getCentroidAndDispersion = () => {
    const imps = impacts.filter(imp => imp.endIdx === currentEnd);
    if (imps.length === 0) return null;

    let sumX = 0;
    let sumY = 0;
    imps.forEach(imp => {
      sumX += imp.x;
      sumY += imp.y;
    });
    const cx = sumX / imps.length;
    const cy = sumY / imps.length;

    let sumDist = 0;
    imps.forEach(imp => {
      const dx = imp.x - cx;
      const dy = imp.y - cy;
      sumDist += Math.sqrt(dx * dx + dy * dy);
    });
    const dispersion = sumDist / imps.length;

    return { cx, cy, dispersion };
  };

  // Simulate rival shoot-off arrow
  const simulateRivalShootOff = () => {
    setRivalThinking(true);
    setTimeout(() => {
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
          speakRivalPhraseOnMatchEnd(true);
        } else if (rivalShootOffShot > userShootOffShot) {
          setWinner("RIVAL");
          setDuelFinished(true);
          speakRivalPhraseOnMatchEnd(false);
        } else {
          alert("¡Empate en flecha de desempate! Se dispara otra flecha.");
          setUserShootOffShot(null);
          setRivalShootOffShot(null);
        }
      }, 800);
    }
  }, [isShootOff, userShootOffShot, rivalShootOffShot]);

  // Simulate rival shot
  const simulateRivalShot = (nextArrow: number, userEndShots: (string | number)[]) => {
    setRivalThinking(true);
    const delay = 1200 + Math.random() * 1200;
    setTimeout(() => {
      const updatedRival = [...rivalTiros];
      const ratingVal = config.rival.rating;
      const rand = Math.random();
      
      let rivalScore = "9";
      if (ratingVal >= 9.4) {
        rivalScore = rand > 0.45 ? "10" : rand > 0.08 ? "9" : "8";
      } else if (ratingVal >= 9.0) {
        rivalScore = rand > 0.65 ? "10" : rand > 0.25 ? "9" : rand > 0.05 ? "8" : "7";
      } else {
        rivalScore = rand > 0.8 ? "10" : rand > 0.45 ? "9" : rand > 0.15 ? "8" : "7";
      }

      updatedRival[currentEnd] = [...(updatedRival[currentEnd] || []), rivalScore];
      setRivalTiros(updatedRival);
      setRivalThinking(false);

      // Check if end is complete (3 arrows each)
      if (nextArrow === 3) {
        evaluateEndCompletion(userEndShots, updatedRival[currentEnd]);
      } else {
        // Activate Ready Check for the next arrow!
        setIsUserReady(false);
        setIsRivalReady(false);
        setIsReadyCheckActive(true);
      }
    }, delay);
  };

  // Simulate rival upload delay
  const simulateRivalUpload = () => {
    setTimeout(() => {
      setRivalPhoto("rival_done");
    }, 1500);
  };

  // Evaluate points after end completion
  const evaluateEndCompletion = (userEndShots: (string | number)[], rivalEndShots: (string | number)[]) => {
    const userSum = userEndShots.reduce((sum: number, b) => sum + getValNumeric(b), 0);
    const rivalSum = rivalEndShots.reduce((sum: number, b) => sum + getValNumeric(b), 0);

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
      // Set recurve set system logic
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

    setEndSummaryMsg(summaryMsg);
    setUserPhoto(null);
    setRivalPhoto(null);
    setValidationPhase("UPLOAD"); // Start photo validation flow!
  };

  // Evaluate set/match winner after points update
  useEffect(() => {
    if (endSummary === null) return;

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
      if (userSetPoints >= 6 && userSetPoints > rivalSetPoints) {
        matchOver = true;
        finalWinner = "USER";
      } else if (rivalSetPoints >= 6 && rivalSetPoints > userSetPoints) {
        matchOver = true;
        finalWinner = "RIVAL";
      } else if (nextEnd === 5) {
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
        speakRivalPhraseOnMatchEnd(finalWinner === "USER");
      }
    }
  }, [userSetPoints, rivalSetPoints, endSummary]);

  const handleNextEnd = () => {
    setEndSummary(null);
    setEndSummaryMsg(null);
    setValidationPhase("IDLE");
    setUserPhoto(null);
    setRivalPhoto(null);
    setCurrentEnd((prev) => prev + 1);
    setCurrentArrow(0);
    setIsUserReady(false);
    setIsRivalReady(false);
    setIsReadyCheckActive(true);
  };

  const getCumulativeTotal = (tiros: (string | number)[][]): number => {
    return tiros.reduce((sum: number, end) => sum + end.reduce((endSum: number, b) => endSum + getValNumeric(b), 0), 0);
  };

  const triggerConfetti = () => {
    confetti({
      particleCount: 120,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  // Save completed duel session to IndexedDB
  const handleSaveAndExit = async () => {
    const totalUserArrows = userTiros.flat().length + (userShootOffShot !== null ? 1 : 0);
    const userTotalScore = userTiros.flat().reduce((sum: number, b) => sum + getValNumeric(b), 0) + (userShootOffShot || 0);
    const duelId = config.id || generateResilientId("DUE");

    const newSession = {
      uid: duelId,
      userUid: user.uid,
      userName: user.fullName,
      timestamp: Date.now(),
      practiceType: "Control",
      bowConfig: { type: config.bowType, brand: user.bowConfig.brand, model: user.bowConfig.model, poundage: user.bowConfig.poundage },
      endsCount: userTiros.filter(e => e.length > 0).length,
      arrowsPerEnd: 3,
      distance: config.distance,
      score: userTotalScore,
      maxScore: userTiros.filter(e => e.length > 0).length * 30 + (userShootOffShot !== null ? 10 : 0),
      warmupArrows: 0,
      isDuel: true,
      isDraft: false, // Mark completed to distinguish from drafts!
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
  const userFlag = COUNTRIES.find(c => c.code === user.country)?.flag || "🇨🇷";

  // Confirm and go back warning if match in progress
  const handleBackWithConfirm = () => {
    if (duelFinished) {
      onBack();
      return;
    }
    const confirmExit = window.confirm("¿Seguro que quieres salir? El progreso del duelo se guardará automáticamente como borrador.");
    if (confirmExit) {
      onBack();
    }
  };

  return (
    <div className="flex flex-col gap-4 py-3 min-h-full relative overflow-hidden select-none">
      
      {/* Background neon dynamic blobs */}
      <div className="absolute top-[-10%] left-[-15%] w-[70%] aspect-square rounded-full bg-purple-500/10 blur-[100px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-15%] w-[70%] aspect-square rounded-full bg-cyan-neon/10 blur-[100px] pointer-events-none z-0" />

      {/* Arena Header Status bar */}
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-2 z-10">
        <button
          onClick={handleBackWithConfirm}
          disabled={rivalThinking}
          className={`p-2 rounded-xl bg-neutral-900/60 backdrop-blur-md border border-white/10 text-gray-dim hover:text-white transition ${
            rivalThinking ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[10px] text-purple-400 font-black tracking-widest uppercase">
          {isShootOff ? "Flecha Desempate" : `Set ${currentEnd + 1} de 5`}
        </span>
        
        {/* Countdown timer */}
        <div className="w-10 flex justify-end">
          {!rivalThinking && !duelFinished && !endSummary && !showRules && validationPhase === "IDLE" && (
            <span className={`text-xs font-mono font-black border px-2 py-0.5 rounded-full ${
              timeLeft <= 10
                ? "text-red-500 border-red-500/30 bg-red-500/10 animate-pulse"
                : "text-cyan-neon border-cyan-neon/30 bg-cyan-neon/10"
            }`}>
              {timeLeft}s
            </span>
          )}
        </div>
      </div>

      {/* Duelist panels and live scoreboard */}
      <div className="bg-neutral-900/60 backdrop-blur-md border border-white/10 rounded-3xl p-4 flex flex-col gap-3.5 z-10 relative overflow-hidden">
        
        {/* Score grid */}
        <div className="grid grid-cols-5 items-center gap-1">
          {/* Athlete (User) Panel */}
          <div className="col-span-2 flex flex-col items-center gap-1 text-center">
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-xl bg-cyan-neon/5 border border-cyan-neon/30 flex items-center justify-center text-cyan-neon font-black text-sm shadow-glow-cyan relative">
                {user.fullName.substring(0, 2).toUpperCase()}
              </div>
              <span className="absolute -bottom-1 -right-1 text-[11px] drop-shadow-md bg-neutral-950/80 px-0.5 rounded">{userFlag}</span>
            </div>
            <span className="text-[11px] text-white font-extrabold truncate max-w-[95px] mt-1">
              Tú ({config.bowType})
            </span>
            <span className="text-[9px] text-gray-dim flex items-center gap-0.5 max-w-[95px] truncate mt-0.5">
              <ClubLogoIcon logo={user.clubLogo || "0"} className="w-3 h-3 shrink-0" />
              <span className="truncate">{user.clubName || "Independiente"}</span>
            </span>
          </div>

          {/* Central score digits */}
          <div className="col-span-1 flex flex-col items-center justify-center">
            {isCompound ? (
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
          <div className="col-span-2 flex flex-col items-center gap-1 text-center">
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-xl bg-red-rival/5 border border-red-rival/30 flex items-center justify-center text-red-rival font-black text-sm shadow-glow-red relative">
                {currentRivalName.substring(0, 2).toUpperCase()}
              </div>
              <span className="absolute -bottom-1 -right-1 text-[11px] drop-shadow-md bg-neutral-950/80 px-0.5 rounded">{currentRivalFlag}</span>
            </div>
            <span className="text-[11px] text-white font-extrabold truncate max-w-[95px] mt-1">
              {currentRivalName}
            </span>
            <span className="text-[9px] text-gray-dim flex items-center gap-0.5 max-w-[95px] truncate mt-0.5">
              <ClubLogoIcon logo={config.rival.clubLogo || "0"} className="w-3 h-3 shrink-0" />
              <span className="truncate">{config.rival.clubName || "Club Rival"}</span>
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

        {/* Live arrow-by-arrow scoring list for current end (only if in TARGET mode) */}
        {!isShootOff && mode === "TARGET" && (
          <div className="border-t border-white/[0.03] pt-3 flex flex-col gap-2">
            <span className="text-[8px] text-gray-dim font-black uppercase tracking-wider text-center">
              Flechas End Actual
            </span>
            <div className="grid grid-cols-2 gap-6">
              {/* User shots */}
              <div className="flex justify-end gap-1.5">
                {[0, 1, 2].map((idx) => {
                  const val = userTiros[currentEnd]?.[idx];
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
                  const val = rivalTiros[currentEnd]?.[idx];
                  const isLoading = idx === (userTiros[currentEnd]?.length ?? 0) - 1 && rivalThinking;
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

      {/* Ready Check Panel */}
      {isReadyCheckActive && !duelFinished && (
        <div className="flex-1 flex flex-col justify-center items-center py-6 px-4 z-10 relative bg-neutral-900/30 border border-white/5 rounded-3xl min-h-[300px] text-center shadow-inner overflow-hidden my-auto">
          <div className="absolute inset-0 bg-radial-glow opacity-5 pointer-events-none" />
          
          <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-[280px]">
            {/* Header / Subtitle */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-purple-400 font-black tracking-widest uppercase block animate-pulse">
                LÍNEA DE TIRO
              </span>
              <h3 className="text-white text-base font-black uppercase tracking-wide">
                Preparación de Flecha {currentArrow + 1}
              </h3>
              <p className="text-[9px] text-gray-dim uppercase font-bold">
                Ambos arqueros deben reportarse listos
              </p>
            </div>

            {/* Duelists status cards */}
            <div className="grid grid-cols-2 gap-3 w-full my-3">
              {/* User ready box */}
              <div className={`p-3 rounded-2xl border flex flex-col items-center gap-2 transition-all duration-200 ${
                isUserReady 
                  ? "bg-cyan-neon/5 border-cyan-neon/30 text-cyan-neon font-black" 
                  : "bg-neutral-900/60 border-white/5 text-gray-dim"
              }`}>
                <div className="w-10 h-10 rounded-full bg-neutral-950 border border-white/5 flex items-center justify-center text-xs font-black relative">
                  {user.fullName.substring(0, 2).toUpperCase()}
                  {isUserReady && <span className="absolute -bottom-1 -right-1 text-xs">✅</span>}
                </div>
                <span className="text-[10px] font-bold truncate max-w-full">Tú</span>
                <span className="text-[9px] font-black uppercase tracking-wider">
                  {isUserReady ? "Listo" : "Espera..."}
                </span>
              </div>

              {/* Rival ready box */}
              <div className={`p-3 rounded-2xl border flex flex-col items-center gap-2 transition-all duration-200 ${
                isRivalReady 
                  ? "bg-purple-500/5 border-purple-500/30 text-purple-400 font-black" 
                  : "bg-neutral-900/60 border-white/5 text-gray-dim animate-pulse"
              }`}>
                <div className="w-10 h-10 rounded-full bg-neutral-950 border border-white/5 flex items-center justify-center text-xs font-black relative">
                  {config.rival.fullName.substring(0, 2).toUpperCase()}
                  {isRivalReady && <span className="absolute -bottom-1 -right-1 text-xs">✅</span>}
                </div>
                <span className="text-[10px] font-bold truncate max-w-full">{config.rival.fullName}</span>
                <span className="text-[9px] font-black uppercase tracking-wider">
                  {isRivalReady ? "Listo" : "Pensando..."}
                </span>
              </div>
            </div>

            {/* Countdown Overlay or Ready CTA */}
            {readyCountdown !== null ? (
              <div className="flex flex-col items-center justify-center my-2">
                <span className="text-[10px] text-yellow-gold font-black tracking-widest uppercase mb-1">
                  COMIENZO EN
                </span>
                <motion.div
                  key={readyCountdown}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1.2, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  className="text-4xl font-black text-white font-mono"
                >
                  {readyCountdown > 0 ? readyCountdown : "🎯"}
                </motion.div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setIsUserReady(true);
                  if (navigator.vibrate) {
                    navigator.vibrate(30);
                  }
                }}
                disabled={isUserReady}
                className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all duration-200 ${
                  isUserReady
                    ? "bg-neutral-900 border border-white/5 text-gray-dim cursor-default"
                    : "bg-gradient-to-r from-cyan-brand to-cyan-neon text-black shadow-glow-cyan hover:brightness-105 active:scale-98 cursor-pointer"
                }`}
              >
                {isUserReady ? "Esperando al Rival..." : "¡Listo en Línea! 🏹"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mode Selector Toggle */}
      {!duelFinished && !isReadyCheckActive && (
        <div className="flex bg-neutral-900 border border-white/10 p-0.5 rounded-xl max-w-[200px] mx-auto z-10 relative">
          <button
            onClick={() => setMode("TARGET")}
            className={`flex-1 py-1 px-3 rounded-lg text-[10px] font-black uppercase transition-all ${
              mode === "TARGET"
                ? "bg-cyan-neon text-black shadow-glow-cyan"
                : "text-gray-dim hover:text-white"
            }`}
          >
            Diana
          </button>
          <button
            onClick={() => setMode("KEYBOARD")}
            className={`flex-1 py-1 px-3 rounded-lg text-[10px] font-black uppercase transition-all ${
              mode === "KEYBOARD"
                ? "bg-cyan-neon text-black shadow-glow-cyan"
                : "text-gray-dim hover:text-white"
            }`}
          >
            Teclado
          </button>
        </div>
      )}

      {/* Target Arena (Diana Mode) */}
      {!duelFinished && !isReadyCheckActive && mode === "TARGET" && (
        <div className="flex-1 flex flex-col justify-center items-center gap-3 z-10 relative">
          
          {/* Backdrop overlay when zoomed */}
          {isDianaZoomed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDianaZoomed(false)}
              className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40"
            />
          )}

          {/* Instruction Banner when zoomed */}
          {isDianaZoomed && (
            <div className="fixed top-12 left-0 right-0 z-50 flex justify-center pointer-events-none px-4">
              <div className="bg-neutral-900/90 border border-purple-500/30 backdrop-blur-md px-4 py-2 rounded-full shadow-[0_0_15px_rgba(168,85,247,0.15)] text-center">
                <span className="text-[10px] text-purple-400 font-black tracking-widest uppercase block leading-none">
                  Diana Ampliada
                </span>
                <span className="text-[9px] text-gray-300 mt-1 block leading-none">
                  Arrastra o toca para precisar · Suelta para registrar
                </span>
              </div>
            </div>
          )}

          {/* Zoom coordinate info & value */}
          <div className="flex gap-4 items-center justify-center bg-black/40 px-4 py-1.5 rounded-full border border-white/5 text-[10px] font-bold z-10">
            <span className="text-gray-dim">Puntuación Estimada:</span>
            <span className="text-yellow-gold font-extrabold text-xs">
              🎯 {getCoordsFromClient(cursorPos.x, cursorPos.y)?.value || "M"} Ptos
            </span>
          </div>

          {/* Interactive target SVG (100x100 base) */}
          <div className="relative w-full max-w-[250px] aspect-square bg-neutral-950/30 rounded-full border border-white/5 flex items-center justify-center shadow-2xl overflow-visible">
            
            <motion.svg
              ref={dianaRef}
              viewBox="0 0 100 100"
              animate={{ scale: isDianaZoomed ? 2.2 : 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className={`w-full h-full cursor-crosshair select-none overflow-visible relative transition-all duration-300 ${
                isDianaZoomed ? "z-50" : "z-10"
              }`}
            >
              {/* Draw rings */}
              {[...presetRings].sort((a, b) => b.r - a.r).map((ring, idx) => (
                <circle
                  key={idx}
                  cx="50"
                  cy="50"
                  r={ring.r}
                  fill={ring.fill}
                  stroke={ring.stroke}
                  strokeWidth="0.3"
                />
              ))}

              {/* Cursor Point */}
              <circle
                cx={cursorPos.x}
                cy={cursorPos.y}
                r="1.5"
                className="fill-purple-400 stroke-white stroke-[0.4px] shadow-glow-purple pointer-events-none"
              />
              
              {/* Crosshair on cursor */}
              <line x1={cursorPos.x - 3} y1={cursorPos.y} x2={cursorPos.x + 3} y2={cursorPos.y} stroke="white" strokeWidth="0.25" />
              <line x1={cursorPos.x} y1={cursorPos.y - 3} x2={cursorPos.x} y2={cursorPos.y + 3} stroke="white" strokeWidth="0.25" />
              
              {/* Centroid and Dispersion group */}
              {(() => {
                const stats = getCentroidAndDispersion();
                if (!stats || stats.dispersion === 0) return null;
                return (
                  <>
                    <circle cx={stats.cx} cy={stats.cy} r="0.8" fill="#FFC107" stroke="#FFF" strokeWidth="0.2" />
                    <circle
                      cx={stats.cx}
                      cy={stats.cy}
                      r={stats.dispersion}
                      fill="rgba(255, 193, 7, 0.12)"
                      stroke="#FFC107"
                      strokeWidth="0.3"
                      strokeDasharray="1,1"
                    />
                  </>
                );
              })()}

              {/* User Impact points */}
              {impacts.filter(imp => imp.endIdx === currentEnd).map((imp, idx) => (
                <circle
                  key={idx}
                  cx={imp.x}
                  cy={imp.y}
                  r="1.2"
                  className="fill-cyan-neon stroke-white stroke-[0.3px]"
                />
              ))}
            </motion.svg>
          </div>

          <span className="text-[8px] text-gray-dim font-bold uppercase text-center mt-1 z-10">
            Desliza sobre la diana para ampliarla · Suelta para registrar
          </span>
        </div>
      )}

      {/* Keyboard Mode Arena */}
      {!duelFinished && !isReadyCheckActive && mode === "KEYBOARD" && (
        <div className="flex-1 flex flex-col gap-3 justify-between z-10 relative">
          
          {/* Side-by-side match progress table */}
          <div className="w-full max-w-[320px] mx-auto overflow-y-auto border border-white/10 rounded-2xl bg-neutral-950/40 max-h-[140px] z-10 relative">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="bg-neutral-900/80 text-gray-dim font-bold uppercase text-[8px] tracking-wider border-b border-white/10 text-center">
                  <th className="py-2 px-1">Set</th>
                  <th className="py-2 px-1">Tus Tiros</th>
                  <th className="py-2 px-1">Tú</th>
                  <th className="py-2 px-1">Rival</th>
                  <th className="py-2 px-1">Tiros Rival</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4].map((idx) => {
                  const isCurrent = currentEnd === idx;
                  
                  const userEnd = userTiros[idx] || [];
                  const rivalEnd = rivalTiros[idx] || [];
                  
                  const userSum = userEnd.reduce((sum: number, b) => sum + getValNumeric(b), 0);
                  const rivalSum = rivalEnd.reduce((sum: number, b) => sum + getValNumeric(b), 0);

                  if (idx > currentEnd && userEnd.length === 0 && rivalEnd.length === 0) return null;

                  return (
                    <tr
                      key={idx}
                      className={`border-b border-white/5 transition text-center ${
                        isCurrent ? "bg-cyan-neon/5 border-cyan-neon/20" : ""
                      }`}
                    >
                      <td className="py-2 px-1 font-bold text-gray-dim">{idx + 1}</td>
                      
                      {/* User shots */}
                      <td className="py-2 px-1">
                        <div className="flex justify-center gap-1">
                          {[0, 1, 2].map((arrowIdx) => {
                            const val = userEnd[arrowIdx];
                            const isEditing = isCurrent && currentArrow === arrowIdx && mode === "KEYBOARD";
                            return (
                              <span
                                key={arrowIdx}
                                className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[9px] border ${
                                  val !== undefined
                                    ? "bg-cyan-neon/10 border-cyan-neon/40 text-cyan-neon shadow-glow-cyan"
                                    : isEditing
                                    ? "border-cyan-neon ring-1 ring-cyan-neon animate-pulse"
                                    : "bg-neutral-900 border-white/5 text-gray-600"
                                }`}
                              >
                                {val !== undefined ? val : ""}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      {/* User Total */}
                      <td className="py-2 px-1 font-extrabold text-cyan-neon">
                        {userEnd.length > 0 ? userSum : "—"}
                      </td>

                      {/* Rival Total */}
                      <td className="py-2 px-1 font-extrabold text-red-rival">
                        {rivalEnd.length > 0 ? rivalSum : "—"}
                      </td>

                      {/* Rival shots */}
                      <td className="py-2 px-1">
                        <div className="flex justify-center gap-1">
                          {[0, 1, 2].map((arrowIdx) => {
                            const val = rivalEnd[arrowIdx];
                            const isLoading = isCurrent && arrowIdx === userEnd.length - 1 && rivalThinking;
                            return (
                              <span
                                key={arrowIdx}
                                className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[9px] border ${
                                  val !== undefined
                                    ? "bg-red-rival/10 border-red-rival/40 text-red-rival shadow-glow-red"
                                    : isLoading
                                    ? "border-purple-400 animate-spin bg-purple-500/5"
                                    : "bg-neutral-900 border-white/5 text-gray-600"
                                }`}
                              >
                                {val !== undefined ? val : isLoading ? "●" : ""}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Keypad Buttons 4x4 */}
          <div className="grid grid-cols-4 gap-2 mt-2 w-full max-w-[320px] mx-auto">
            {/* Max points */}
            {["X", "10", "9"].map((key) => (
              <button
                key={key}
                onClick={() => handleScoreInput(key)}
                className="py-3.5 rounded-xl border-2 border-yellow-gold text-yellow-gold font-extrabold text-sm flex items-center justify-center cursor-pointer shadow-[0_0_10px_rgba(255,242,0,0.15)] hover:bg-yellow-gold/10 active:scale-95 transition"
              >
                {key}
              </button>
            ))}
            {/* Backspace */}
            <button
              onClick={handleBackspace}
              className="py-3.5 rounded-xl border border-white/10 bg-neutral-900 text-gray-dim font-bold text-sm flex items-center justify-center cursor-pointer hover:text-white hover:bg-neutral-850 active:scale-95 transition"
            >
              ⌫
            </button>

            {/* Standard points 8-5 */}
            {["8", "7", "6", "5"].map((key) => (
              <button
                key={key}
                onClick={() => handleScoreInput(key)}
                className="py-3.5 rounded-xl border border-cyan-brand/60 text-white font-bold text-sm flex items-center justify-center cursor-pointer hover:border-cyan-neon hover:bg-cyan-neon/5 active:scale-95 transition"
              >
                {key}
              </button>
            ))}

            {/* Standard points 4-1 */}
            {["4", "3", "2", "1"].map((key) => (
              <button
                key={key}
                onClick={() => handleScoreInput(key)}
                className="py-3.5 rounded-xl border border-cyan-brand/60 text-white font-bold text-sm flex items-center justify-center cursor-pointer hover:border-cyan-neon hover:bg-cyan-neon/5 active:scale-95 transition"
              >
                {key}
              </button>
            ))}

            {/* Miss */}
            <button
              onClick={() => handleScoreInput("M")}
              className="col-span-4 py-3.5 rounded-xl border border-red-rival/40 text-red-rival font-extrabold text-xs flex items-center justify-center uppercase cursor-pointer hover:bg-red-rival/10 active:scale-95 transition"
            >
              Miss (M)
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons (Undo only, Confirm is automatic) */}
      {!duelFinished && mode === "TARGET" && (
        <div className="flex px-1 z-10 mt-auto">
          <button
            onClick={handleUndo}
            disabled={
              rivalThinking || 
              (isShootOff && userShootOffShot === null) || 
              (!isShootOff && (userTiros[currentEnd]?.length ?? 0) === 0)
            }
            className="w-full h-12 rounded-2xl bg-neutral-900 border border-white/5 text-gray-dim hover:text-red-rival flex items-center justify-center gap-1.5 cursor-pointer transition disabled:opacity-20 disabled:cursor-not-allowed text-xs font-black uppercase tracking-wider"
            title="Deshacer Tiro"
          >
            <RotateCcw size={14} />
            <span>Deshacer Último Tiro</span>
          </button>
        </div>
      )}

      {/* Target Zoom Lupa Hovering box */}
      {lupaState.active && (
        <div
          className="fixed pointer-events-none z-[99999] border-2 border-yellow-gold/60 rounded-full overflow-hidden shadow-[0_0_20px_rgba(255,242,0,0.4)] bg-neutral-950"
          style={{
            left: lupaState.clientX - 65,
            top: lupaState.clientY - 145,
            width: "130px",
            height: "130px"
          }}
        >
          <svg
            viewBox={`${lupaState.x - 12} ${lupaState.y - 12} 24 24`}
            className="w-full h-full"
          >
            {[...presetRings].sort((a, b) => b.r - a.r).map((ring, idx) => (
              <circle
                key={idx}
                cx="50"
                cy="50"
                r={ring.r}
                fill={ring.fill}
                stroke={ring.stroke}
                strokeWidth="0.2"
              />
            ))}
            <circle
              cx={lupaState.x}
              cy={lupaState.y}
              r="0.5"
              className="fill-purple-400 stroke-white stroke-[0.1px]"
            />
            <line x1={lupaState.x - 2} y1={lupaState.y} x2={lupaState.x + 2} y2={lupaState.y} stroke="white" strokeWidth="0.1" />
            <line x1={lupaState.x} y1={lupaState.y - 2} x2={lupaState.x} y2={lupaState.y + 2} stroke="white" strokeWidth="0.1" />
          </svg>
          <div className="absolute bottom-1.5 inset-x-0 text-[10px] font-black text-center text-yellow-gold drop-shadow-[0_1px_2px_rgba(0,0,0,1)] uppercase leading-none">
            {lupaState.value}
          </div>
        </div>
      )}

      {/* Walkie-Talkie Floating Controller */}
      {!duelFinished && (
        <div className="fixed bottom-24 right-5 z-[80] flex flex-col items-end gap-2.5 pointer-events-auto">
          {/* Audio Bubble Overlay */}
          <AnimatePresence>
            {walkieText && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85, y: 10 }}
                className="bg-neutral-950 border border-purple-500/30 p-3 rounded-2xl max-w-[200px] shadow-2xl relative"
              >
                {/* Triangular arrow point */}
                <div className="absolute right-5 -bottom-1.5 w-3 h-3 bg-neutral-950 border-r border-b border-purple-500/30 rotate-45" />
                
                <span className="text-[8px] text-purple-400 font-black tracking-widest uppercase block mb-1">
                  📻 CANAL DE VOZ · RIVAL
                </span>
                <p className="text-[10px] text-white leading-snug font-bold">
                  "{walkieText}"
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Micro Walkie-Talkie Button */}
          <div className="flex items-center gap-2">
            <AnimatePresence>
              {isWalkieTalkieActive && (
                <motion.span
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="text-[8px] bg-neutral-950/85 backdrop-blur border border-cyan-neon/30 text-cyan-neon font-black px-2.5 py-1 rounded-full uppercase tracking-wider shadow"
                >
                  {isRivalSpeaking ? "🎙️ Transmitiendo..." : "📻 Walkie ON"}
                </motion.span>
              )}
            </AnimatePresence>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                setIsWalkieTalkieActive(!isWalkieTalkieActive);
                if (navigator.vibrate) {
                  navigator.vibrate(40);
                }
              }}
              className={`w-12 h-12 rounded-full flex items-center justify-center border cursor-pointer shadow-xl relative overflow-hidden transition-all duration-300 ${
                isWalkieTalkieActive
                  ? "bg-cyan-neon/10 border-cyan-neon text-cyan-neon shadow-[0_0_20px_rgba(0,229,255,0.15)]"
                  : "bg-neutral-900 border-white/10 text-gray-dim hover:text-white"
              }`}
            >
              {/* Dynamic waveform visualization inside button */}
              {isWalkieTalkieActive ? (
                <div className="flex items-end gap-0.5 h-4 justify-center">
                  {walkieWaveAnim.map((height, idx) => (
                    <motion.div
                      key={idx}
                      animate={{ height }}
                      className="w-0.75 bg-cyan-neon rounded-full"
                      style={{ height: `${height}px` }}
                    />
                  ))}
                </div>
              ) : (
                <Mic size={18} />
              )}

              {/* Status active pulsing dot */}
              {isWalkieTalkieActive && (
                <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-cyan-neon animate-ping" />
              )}
            </motion.button>
          </div>
        </div>
      )}

      {/* Photo Validation Modal Overlay */}
      <AnimatePresence>
        {validationPhase !== "IDLE" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              variants={popVariants}
              initial="initial"
              animate="animate"
              exit="initial"
              className="w-full max-w-[340px] bg-neutral-950 border border-purple-500/30 p-5 rounded-[32px] flex flex-col gap-4 shadow-2xl relative overflow-hidden"
            >
              {/* Header effect */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-cyan-neon" />

              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <div>
                  <h3 className="text-white text-xs font-black uppercase tracking-wider">
                    Validación de Diana - Set {currentEnd + 1}
                  </h3>
                  <p className="text-[8px] text-gray-dim uppercase tracking-widest font-bold">
                    Revisión de Impactos del Turno
                  </p>
                </div>
                <span className="text-[10px] text-cyan-neon font-mono font-bold bg-cyan-neon/10 px-2 py-0.5 rounded-full border border-cyan-neon/20">
                  {config.distance}m
                </span>
              </div>

              {validationPhase === "UPLOAD" && (
                <div className="flex flex-col gap-3.5">
                  <p className="text-[10px] text-gray-dim leading-relaxed">
                    Sube una foto de tu diana de este set para que tu rival verifique tus puntuaciones.
                  </p>

                  {/* Upload box */}
                  <label className="border border-dashed border-white/10 hover:border-purple-400/40 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-neutral-900/40 min-h-[110px] relative overflow-hidden group transition-all">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = URL.createObjectURL(file);
                          setUserPhoto(url);
                          simulateRivalUpload();
                        }
                      }}
                    />
                    
                    {userPhoto ? (
                      <img src={userPhoto} alt="Tu diana" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <>
                        <span className="text-2xl group-hover:scale-110 transition">📸</span>
                        <span className="text-[10px] text-white font-bold uppercase tracking-wider">Tomar o subir foto</span>
                        <span className="text-[8px] text-gray-dim">JPG, PNG hasta 5MB</span>
                      </>
                    )}
                  </label>

                  {/* Status Indicator */}
                  <div className="flex items-center justify-between bg-black/40 px-3 py-2 rounded-xl border border-white/5 text-[9px] font-bold">
                    <span className="text-gray-dim">Tu Estado:</span>
                    <span className={userPhoto ? "text-cyan-neon animate-pulse" : "text-yellow-gold"}>
                      {userPhoto ? "✓ Foto Subida" : "⌛ Pendiente de foto"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between bg-black/40 px-3 py-2 rounded-xl border border-white/5 text-[9px] font-bold">
                    <span className="text-gray-dim">Estado del Rival:</span>
                    <span className={rivalPhoto ? "text-cyan-neon" : "text-yellow-gold flex items-center gap-1"}>
                      {rivalPhoto ? "✓ Foto Subida" : (
                        <>
                          <span className="inline-block w-1.5 h-1.5 border border-yellow-gold border-t-transparent animate-spin rounded-full" />
                          <span>Esperando rival...</span>
                        </>
                      )}
                    </span>
                  </div>

                  <button
                    onClick={() => setValidationPhase("REVIEW")}
                    disabled={!userPhoto || !rivalPhoto}
                    className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-900 disabled:text-gray-dim disabled:border border-white/5 text-white font-bold text-xs uppercase tracking-wider cursor-pointer transition active:scale-95 flex items-center justify-center gap-1.5 font-black"
                  >
                    <span>Revisar Diana Rival</span>
                    <span>→</span>
                  </button>
                </div>
              )}

              {validationPhase === "REVIEW" && (
                <div className="flex flex-col gap-3.5">
                  <p className="text-[10px] text-gray-dim leading-relaxed">
                    Compara los impactos declarados por <span className="text-white font-bold">{config.rival.fullName}</span> en la diana virtual con su foto real.
                  </p>

                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="flex flex-col gap-1 text-center">
                      <span className="text-[8px] text-gray-dim uppercase font-bold">Foto del Rival</span>
                      <div className="w-full aspect-square rounded-xl bg-neutral-900 border border-white/5 flex items-center justify-center overflow-hidden relative">
                        <div className="absolute inset-0 bg-neutral-950 flex items-center justify-center">
                          <svg viewBox="0 0 100 100" className="w-full h-full p-2">
                            {[...presetRings].sort((a, b) => b.r - a.r).map((ring, idx) => (
                              <circle
                                key={idx}
                                cx="50"
                                cy="50"
                                r={ring.r}
                                fill={ring.fill}
                                stroke={ring.stroke}
                                strokeWidth="0.2"
                              />
                            ))}
                            
                            {/* Render rival simulated impacts */}
                            {(rivalTiros[currentEnd] || []).map((val, idx) => {
                              const coords = getCoordinatesForScore(String(val));
                              // Jitter slightly for natural realism
                              const jX = coords.x + (idx - 1) * 2;
                              const jY = coords.y + (idx % 2 === 0 ? 1 : -1) * 1.5;
                              return (
                                <circle
                                  key={idx}
                                  cx={jX}
                                  cy={jY}
                                  r="2"
                                  fill="#E53935"
                                  stroke="#FFFFFF"
                                  strokeWidth="0.4"
                                />
                              );
                            })}
                          </svg>
                        </div>
                        <span className="absolute bottom-1 right-1 text-[8px] bg-red-rival/80 text-white font-black px-1 py-0.2 rounded uppercase">
                          DIANA RIVAL
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="text-[8px] text-gray-dim uppercase font-bold">Impactos Registrados</span>
                      <div className="bg-neutral-900/60 border border-white/5 p-3 rounded-xl flex flex-col gap-2">
                        {(rivalTiros[currentEnd] || []).map((val, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs">
                            <span className="text-gray-dim">Flecha {idx + 1}:</span>
                            <span className="text-white font-black">{val} Pts</span>
                          </div>
                        ))}
                        <div className="h-[1px] bg-white/5 my-1" />
                        <div className="flex justify-between items-center text-xs font-bold text-red-rival">
                          <span>Total End:</span>
                          <span>{(rivalTiros[currentEnd] || []).reduce((sum: number, b) => sum + getValNumeric(b), 0)} Pts</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="text-[8px] text-yellow-gold font-bold leading-tight">
                    ⚠ Las fotos de validación se eliminarán de forma segura al finalizar el duelo para ahorrar almacenamiento.
                  </p>

                  <button
                    onClick={() => {
                      setValidationPhase("IDLE");
                      setEndSummary(endSummaryMsg);
                    }}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider cursor-pointer transition active:scale-95 text-center shadow-glow-cyan"
                  >
                    Aceptar y Validar
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs uppercase tracking-wider cursor-pointer active:scale-95 transition font-black"
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
                    {userTiros.flat().reduce((sum: number, val) => sum + getValNumeric(val), 0)} pts
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs py-1 border-b border-white/[0.03]">
                  <span className="text-gray-dim">Puntuación Rival:</span>
                  <span className="text-red-rival font-black">
                    {rivalTiros.flat().reduce((sum: number, val) => sum + getValNumeric(val), 0)} pts
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
                className="w-full py-3.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs uppercase tracking-wider cursor-pointer hover:brightness-105 active:scale-98 transition shadow-[0_0_20px_rgba(168,85,247,0.2)] text-center font-black"
              >
                Guardar y Volver a Dashboard
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rules Modal Overlay */}
      <AnimatePresence>
        {showRules && (
          <div className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              variants={popVariants}
              initial="initial"
              animate="animate"
              className="w-full max-w-[340px] bg-neutral-950 border border-purple-500/30 p-6 rounded-[36px] flex flex-col gap-4 text-center shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-neon" />
              
              <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto mt-2">
                <HelpCircle size={24} />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-purple-400 font-black tracking-widest uppercase">
                  Reglamento de la Arena
                </span>
                <h3 className="text-white text-base font-black uppercase tracking-wide">
                  Reglas Oficiales 1v1
                </h3>
              </div>

              <div className="flex flex-col gap-3 text-left text-[11px] text-gray-dim mt-2">
                <div className="flex gap-2">
                  <span className="text-purple-400 font-bold shrink-0">⏱</span>
                  <p>
                    <strong className="text-white font-bold">Límite de tiempo:</strong> Tienes 30 segundos por flecha. Si expira el tiempo se anotará un Fallo (Miss) automático.
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="text-purple-400 font-bold shrink-0">📸</span>
                  <p>
                    <strong className="text-white font-bold">Validación fotográfica:</strong> Al final de cada set, ambos subirán una foto del blanco virtual para validación.
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="text-purple-400 font-bold shrink-0">🧹</span>
                  <p>
                    <strong className="text-white font-bold">Limpieza automática:</strong> Las fotos de validación se eliminarán del almacenamiento al finalizar el duelo.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowRules(false)}
                className="w-full py-3 mt-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs uppercase tracking-wider cursor-pointer active:scale-95 transition shadow-[0_0_15px_rgba(168,85,247,0.2)]"
              >
                Comprendido y Listo
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
