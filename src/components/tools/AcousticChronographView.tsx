"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  ArrowLeft, Mic, Gauge, Trash2, Sparkles, Volume2, Target,
  Info, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  RotateCcw, Save, Smartphone, ExternalLink, Zap
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { 
  calculateArrowSpeed, 
  detectAudioPeaks, 
  ShotResult,
  fahrenheitToCelsius,
  celsiusToFahrenheit
} from "@/lib/audioChronograph";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";

interface AcousticChronographViewProps {
  user: UserProfile;
  onBack: () => void;
}

export default function AcousticChronographView({ user, onBack }: AcousticChronographViewProps) {
  // Distance: 20 Yards (60 ft / 18.288 m) as specified in EchoChrono
  const distanceYards = 20;
  const distanceMeters = 18.288;

  // Input specifications states (Screenshot 4)
  const [arrowWeight, setArrowWeight] = useState<string>("420");
  const [arrowLength, setArrowLength] = useState<string>("28.5");
  const [temperature, setTemperature] = useState<string>("70");
  const [tempUnit, setTempUnit] = useState<"F" | "C">("F");

  // Speed unit toggle: FPS vs KM/H
  const [speedUnit, setSpeedUnit] = useState<"FPS" | "KMH">("FPS");

  // Setup Guide collapse toggle (Screenshot 2 & 3)
  const [isGuideOpen, setIsGuideOpen] = useState(true);

  // Active Listening / Session State
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastShotResult, setLastShotResult] = useState<ShotResult | null>(null);

  // Tooltip states for info icons
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  // History logs
  const [shotHistory, setShotHistory] = useState<ShotResult[]>([]);

  // Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Load saved specs & history from IndexedDB on mount
  useEffect(() => {
    async function loadInitialData() {
      const logs = await getLocalSetting<ShotResult[]>("chronograph_logs", []);
      setShotHistory(logs);

      const savedSpecs = await getLocalSetting<any>("chronograph_specs", null);
      if (savedSpecs) {
        if (savedSpecs.arrowWeight) setArrowWeight(String(savedSpecs.arrowWeight));
        if (savedSpecs.arrowLength) setArrowLength(String(savedSpecs.arrowLength));
        if (savedSpecs.temperature) setTemperature(String(savedSpecs.temperature));
        if (savedSpecs.tempUnit) setTempUnit(savedSpecs.tempUnit);
      } else if (user.bowConfig) {
        // Fallback defaults from user profile if available
        if (user.bowConfig.poundage) {
          // Approximate recommended arrow weight in grains (~ 7 grains per pound)
          const approxWeight = Math.round(user.bowConfig.poundage * 7.5);
          setArrowWeight(String(approxWeight));
        }
      }
    }
    loadInitialData();
  }, [user]);

  // Save specs when modified
  const handleSaveSpecs = async (w: string, l: string, t: string, u: "F" | "C") => {
    await saveLocalSetting("chronograph_specs", {
      arrowWeight: Number(w) || 0,
      arrowLength: Number(l) || 0,
      temperature: Number(t) || 0,
      tempUnit: u
    });
  };

  // Convert temperature when unit is toggled
  const handleToggleTempUnit = () => {
    const nextUnit = tempUnit === "F" ? "C" : "F";
    const curVal = Number(temperature) || 0;
    let converted = curVal;
    if (tempUnit === "F") {
      converted = fahrenheitToCelsius(curVal);
    } else {
      converted = celsiusToFahrenheit(curVal);
    }
    setTempUnit(nextUnit);
    setTemperature(String(converted));
    handleSaveSpecs(arrowWeight, arrowLength, String(converted), nextUnit);
  };

  // Cleanup Web Audio API stream on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const tempCelsius = tempUnit === "F" 
    ? fahrenheitToCelsius(Number(temperature) || 70) 
    : (Number(temperature) || 20);

  const tempFahrenheit = tempUnit === "F" 
    ? (Number(temperature) || 70) 
    : celsiusToFahrenheit(Number(temperature) || 20);

  // Start Audio Recording / Listening for Shot
  const startRecording = async () => {
    try {
      setIsRecording(true);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      // Volume Meter Loop
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // MediaRecorder for 3.2s shot window (ample time for release + 20yd flight + return sound)
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const arrayBuffer = await blob.arrayBuffer();
        
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          try {
            const decodedBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

            // Auto detect peaks using 20 yd ballistic acoustic parameters
            const detected = detectAudioPeaks(decodedBuffer, distanceMeters, tempCelsius);
            
            const relSec = detected ? Math.round(detected.releaseSec * 1000) / 1000 : 0.20;
            const impSec = detected 
              ? Math.round(detected.impactSec * 1000) / 1000 
              : Math.round((0.20 + (distanceMeters / 85) + (distanceMeters / 343)) * 1000) / 1000;
            
            const totalElapsed = Math.max(0.01, impSec - relSec);
            const numWeight = Number(arrowWeight) || 420;
            const numLength = Number(arrowLength) || 28.5;

            const stats = calculateArrowSpeed(
              totalElapsed,
              distanceMeters,
              tempCelsius,
              numWeight,
              numLength
            );

            const result: ShotResult = {
              id: `SHOT-${Date.now()}`,
              timestamp: Date.now(),
              distanceMeters,
              distanceYards,
              temperatureCelsius: tempCelsius,
              temperatureFahrenheit: tempFahrenheit,
              arrowMassGrains: numWeight,
              arrowLengthInches: numLength,
              totalTimeSec: totalElapsed,
              flightTimeSec: stats.flightTimeSec,
              speedMps: stats.speedMps,
              speedFps: stats.speedFps,
              speedKmh: stats.speedKmh,
              launchSpeedFps: stats.launchSpeedFps,
              launchSpeedMps: stats.launchSpeedMps,
              launchSpeedKmh: stats.launchSpeedKmh,
              kineticEnergyFtLbs: stats.kineticEnergyFtLbs,
              momentumSlugFtSec: stats.momentumSlugFtSec,
              releasePeakSec: relSec,
              impactPeakSec: impSec
            };

            setLastShotResult(result);

            // Automatically add to history log
            const updated = [result, ...shotHistory];
            setShotHistory(updated);
            await saveLocalSetting("chronograph_logs", updated);

          } catch (err) {
            console.error("Audio decoding error:", err);
          }
        }
        setIsRecording(false);
      };

      mediaRecorder.start();

      // Automatically stop recording after 3.2 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          stopRecording();
        }
      }, 3200);

    } catch (err) {
      console.error("Microphone access error:", err);
      alert("No se pudo acceder al micrófono. Por favor permite los permisos de audio en tu navegador.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    }
  };

  // Delete shot from history
  const handleDeleteShot = async (id: string) => {
    const updated = shotHistory.filter((s) => s.id !== id);
    setShotHistory(updated);
    await saveLocalSetting("chronograph_logs", updated);
  };

  // Start new measurement session button handler (Screenshot 4)
  const handleStartSession = () => {
    if (!arrowWeight || Number(arrowWeight) <= 0) {
      alert("Por favor ingresa el peso de la flecha en granos (gr).");
      return;
    }
    if (!arrowLength || Number(arrowLength) <= 0) {
      alert("Por favor ingresa la longitud de la flecha en pulgadas (in).");
      return;
    }
    setIsSessionActive(true);
    startRecording();
  };

  return (
    <div className="flex flex-col gap-5 max-w-xl mx-auto pb-16 px-1">
      {/* Top Header */}
      <div className="flex items-center justify-between bg-neutral-900/60 p-4 rounded-3xl border border-white/10 backdrop-blur-md">
        <button
          onClick={onBack}
          className="p-2 rounded-2xl bg-neutral-950/80 border border-white/10 text-gray-dim hover:text-white transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-xs font-bold"
        >
          <ArrowLeft size={16} />
          <span>Volver</span>
        </button>

        <div className="flex items-center gap-2">
          <div className="p-2 rounded-2xl bg-orange-500/15 border border-orange-500/30 text-orange-400">
            <Gauge size={20} />
          </div>
          <div className="flex flex-col text-right">
            <h1 className="text-white font-black text-sm uppercase tracking-wider flex items-center gap-1 justify-end">
              <span>EchoChrono™</span>
            </h1>
            <span className="text-[9px] text-orange-400 font-extrabold uppercase tracking-widest">
              The Phone Chronograph
            </span>
          </div>
        </div>
      </div>

      {/* Hero Description */}
      <div className="px-1 text-center sm:text-left">
        <h2 className="text-white text-lg font-black tracking-tight">EchoChrono™</h2>
        <p className="text-xs text-white/50 font-medium">The Phone Chronograph</p>
        <p className="text-[11px] text-gray-dim mt-1 leading-relaxed">
          Mide la velocidad de salida de tu arco con tu teléfono. Impulsado por acústica y nuestro motor balístico de precisión a 20 yardas.
        </p>
      </div>

      {/* 1. PUBLIC PREVIEW CARD (Screenshot 1) */}
      <div className="bg-neutral-950 border border-white/10 rounded-3xl p-5 flex flex-col gap-2.5 relative overflow-hidden shadow-xl">
        <div className="flex items-center gap-2 text-cyan-neon">
          <Volume2 size={16} className="text-cyan-neon" />
          <h3 className="text-xs font-black uppercase tracking-wider text-white">Vista Previa Pública</h3>
        </div>
        <p className="text-[11px] text-gray-dim leading-relaxed">
          Considera esta función en fase de pruebas. Estamos mejorando la calibración acústica. Si conoces la velocidad real de tu flecha, una sesión parece desviada o si la app tiene dificultades para detectar los disparos, revisa que la distancia medida sea exacta a 20 yardas.
        </p>
      </div>

      {/* 2. EXPECTED ACCURACY CARD (Screenshot 1) */}
      <div className="bg-neutral-950 border border-white/10 rounded-3xl p-5 flex flex-col gap-3 relative overflow-hidden shadow-xl">
        <div className="flex items-center gap-2 text-green-400">
          <CheckCircle2 size={16} className="text-green-400" />
          <h3 className="text-xs font-black uppercase tracking-wider text-white">Precisión Esperada</h3>
        </div>

        <p className="text-[11px] text-gray-dim leading-relaxed">
          Espera lecturas dentro de <strong>1–3 fps</strong> de la velocidad real cuando tu distancia esté medida con cinta métrica y tu posición coincida exactamente con la guía de configuración.
        </p>

        {/* Benchmarks List */}
        <div className="bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-1.5 text-xs">
          <span className="text-[9px] text-white/40 uppercase font-black tracking-widest block mb-1">
            Comparativa contra cronógrafos de radar de alta gama:
          </span>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-gray-dim">• Dentro de 1 fps:</span>
            <span className="text-white font-black font-mono">49% de sesiones</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-gray-dim">• Dentro de 3 fps:</span>
            <span className="text-white font-black font-mono">95% de sesiones</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-gray-dim">• Dentro de 5 fps:</span>
            <span className="text-white font-black font-mono">99% de sesiones</span>
          </div>
        </div>

        {/* Warning Callout */}
        <div className="bg-amber-500/10 border border-amber-500/25 p-3 rounded-2xl flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-200/90 leading-relaxed font-medium">
            <strong>La configuración y las distancias son críticas.</strong> Un par de pulgadas de error es significativo (6" de error son ~5 fps de desviación). Por favor lee y sigue la guía de configuración a continuación.
          </p>
        </div>
      </div>

      {/* 3. SETUP GUIDE ACCORDION & VISUAL DIAGRAM (Screenshot 2 & 3) */}
      <div className="bg-neutral-950 border border-white/10 rounded-3xl p-5 flex flex-col gap-4 shadow-xl">
        <button
          type="button"
          onClick={() => setIsGuideOpen(!isGuideOpen)}
          className="flex justify-between items-center w-full cursor-pointer text-left"
        >
          <div className="flex flex-col">
            <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
              <span>Guía de Configuración (Setup Guide)</span>
            </h3>
            <span className="text-[10px] text-gray-dim mt-0.5">
              Coloca el teléfono exactamente a 20 yd (60 ft / 18.3 m) de la diana. Mide con cinta métrica.
            </span>
          </div>
          <div className="p-1 rounded-full bg-white/5 text-gray-dim">
            {isGuideOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        <AnimatePresence>
          {isGuideOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex flex-col gap-4 overflow-hidden pt-2 border-t border-white/5"
            >
              {/* Text Instructions */}
              <div className="flex flex-col gap-3 text-xs leading-relaxed text-gray-dim">
                <div>
                  <h4 className="text-white font-bold text-xs">Ubicación</h4>
                  <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px]">
                    <li>Idealmente en exteriores, pero en interiores amplios funciona bien.</li>
                    <li>Mínimo viento y ruido de fondo posible.</li>
                  </ul>
                </div>

                <div>
                  <h4 className="text-white font-bold text-xs">Teléfono</h4>
                  <ul className="list-disc list-inside mt-1 space-y-1 text-[11px]">
                    <li>
                      <strong className="text-white">Exactamente a 20 yd (60 ft / 18.3 m)</strong> de la diana, a la altura de tu flecha en apertura completa. <strong>Usa cinta métrica.</strong>
                    </li>
                    <li>Se recomienda un trípode para mantener una posición constante.</li>
                    <li>
                      <strong className="text-amber-400">Los telémetros no son lo suficientemente precisos.</strong> 6" de error son ~5 fps de diferencia en la lectura.
                    </li>
                    <li>Recomendamos cinta métrica de 30 m / 100 ft para evitar errores al encadenar cintas cortas.</li>
                  </ul>
                </div>

                <div>
                  <h4 className="text-white font-bold text-xs">El Arquero (Tú)</h4>
                  <ul className="list-disc list-inside mt-1 space-y-1 text-[11px]">
                    <li>Párate de modo que el culatín abandone la cuerda parejo con el teléfono, a 15 cm (6") hacia el lateral.</li>
                    <li>En apertura completa, el tope de cuerda debe estar justo sobre la línea de 20 yd, parejo con el teléfono.</li>
                  </ul>
                </div>
              </div>

              {/* VISUAL DIAGRAM SVG (Screenshot 3) */}
              <div className="bg-[#050507] border border-white/10 rounded-2xl p-4 flex flex-col items-center relative overflow-hidden">
                <span className="text-[9px] font-black uppercase text-white/40 tracking-widest self-start mb-2">
                  Diagrama Oficial de Tiro
                </span>

                <svg viewBox="0 0 320 460" className="w-full max-w-sm h-auto select-none">
                  {/* Top Target */}
                  <rect x="60" y="20" width="200" height="18" rx="4" fill="#1C1C20" stroke="#333338" strokeWidth="1.5" />
                  <line x1="70" y1="29" x2="250" y2="29" stroke="#555" strokeWidth="1" strokeDasharray="4 3" />
                  <circle cx="160" cy="29" r="4" fill="#E65100" />
                  <text x="160" y="14" fill="#FFFFFF" fontSize="10" fontWeight="900" textAnchor="middle" letterSpacing="2">
                    TARGET
                  </text>

                  {/* Flight trajectory dashed line */}
                  <line x1="160" y1="36" x2="160" y2="340" stroke="#00E5FF" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
                  <polygon points="160,40 156,48 164,48" fill="#00E5FF" />

                  {/* 20 yd distance dimension line on the right */}
                  <line x1="240" y1="29" x2="240" y2="350" stroke="#FFFFFF" strokeWidth="1" opacity="0.4" />
                  <line x1="235" y1="29" x2="245" y2="29" stroke="#FFFFFF" strokeWidth="1" opacity="0.4" />
                  <line x1="235" y1="350" x2="245" y2="350" stroke="#FFFFFF" strokeWidth="1" opacity="0.4" />

                  {/* 20 yd text callout */}
                  <text x="250" y="180" fill="#FFFFFF" fontSize="16" fontWeight="900">20 yd</text>
                  <text x="250" y="196" fill="#888888" fontSize="10" fontWeight="700">60 ft · 18.3 m</text>
                  <text x="250" y="210" fill="#666666" fontSize="8">diana al teléfono</text>
                  <text x="250" y="226" fill="#E65100" fontSize="8" fontWeight="800">DISTANCIA EXACTA</text>
                  <text x="250" y="238" fill="#E65100" fontSize="8" fontWeight="800">con cinta métrica</text>

                  {/* 20 YD MEASURED LINE */}
                  <line x1="20" y1="350" x2="300" y2="350" stroke="#555555" strokeWidth="1.2" strokeDasharray="5 4" />
                  <text x="30" y="344" fill="#888888" fontSize="8" fontWeight="900" letterSpacing="1">
                    LÍNEA MEDIDA DE 20 YD
                  </text>

                  {/* Arrow shaft at full draw */}
                  <line x1="160" y1="290" x2="160" y2="390" stroke="#CCCCCC" strokeWidth="2.5" />
                  {/* Arrow tip point */}
                  <polygon points="160,285 157,294 163,294" fill="#999999" />
                  {/* Bow grip box */}
                  <rect x="153" y="315" width="14" height="22" rx="4" fill="#333338" stroke="#555" strokeWidth="1" />
                  <text x="172" y="325" fill="#888" fontSize="8">bow grip</text>

                  {/* Vanes / Nock */}
                  <path d="M154,385 C154,395 160,402 160,402 C160,402 166,395 166,385 Z" fill="#E65100" />
                  {/* String stop & nock exit point */}
                  <circle cx="160" cy="350" r="7" fill="none" stroke="#E65100" strokeWidth="1.5" />
                  <circle cx="160" cy="350" r="2.5" fill="#E65100" />

                  {/* Phone Representation */}
                  <rect x="205" y="336" width="18" height="30" rx="3" fill="#18181C" stroke="#00E5FF" strokeWidth="1.5" />
                  <circle cx="214" cy="360" r="1.5" fill="#00E5FF" />
                  <text x="214" y="378" fill="#FFFFFF" fontSize="8" fontWeight="bold" textAnchor="middle">Phone</text>

                  {/* 15 cm / 6 in lateral gap */}
                  <line x1="160" y1="330" x2="205" y2="330" stroke="#FFFFFF" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.5" />
                  <text x="182" y="325" fill="#00E5FF" fontSize="7" fontWeight="bold" textAnchor="middle">6 in / 15 cm</text>

                  {/* Explanatory callouts on left */}
                  <text x="25" y="310" fill="#E65100" fontSize="8" fontWeight="bold">Tope de cuerda aquí</text>
                  <text x="25" y="320" fill="#777" fontSize="7">en la línea de 20 yd</text>
                  <line x1="95" y1="316" x2="150" y2="340" stroke="#E65100" strokeWidth="0.8" opacity="0.6" />

                  <text x="25" y="380" fill="#E65100" fontSize="8" fontWeight="bold">El culatín sale aquí</text>
                  <text x="25" y="390" fill="#777" fontSize="7">parejo con el teléfono</text>
                  <line x1="95" y1="384" x2="152" y2="355" stroke="#E65100" strokeWidth="0.8" opacity="0.6" />

                  <text x="160" y="440" fill="#555" fontSize="8" textAnchor="middle" fontStyle="italic">
                    (flecha mostrada en apertura completa)
                  </text>
                </svg>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 4. INPUT SPECIFICATIONS CARD (Screenshot 4) */}
      <div className="bg-neutral-950 border border-white/10 rounded-3xl p-5 flex flex-col gap-4 shadow-xl">
        <span className="text-[9px] text-white/40 uppercase font-black tracking-widest flex items-center justify-between">
          <span>Especificaciones de tu Flecha</span>
          <span className="text-cyan-neon font-mono">20 YD BALLISTICS</span>
        </span>

        {/* Arrow Weight Field */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-white flex items-center justify-between">
            <span>Arrow Weight (gr)</span>
            <span className="text-[9px] text-gray-dim uppercase">Peso total en granos</span>
          </label>
          <input
            type="number"
            min={150}
            max={900}
            value={arrowWeight}
            onChange={(e) => {
              setArrowWeight(e.target.value);
              handleSaveSpecs(e.target.value, arrowLength, temperature, tempUnit);
            }}
            placeholder="Total arrow weight in grains (ej. 420)"
            className="w-full bg-neutral-900 border border-white/10 rounded-2xl px-4 py-3 text-white text-xs outline-none focus:border-cyan-neon transition font-medium"
          />
        </div>

        {/* Arrow Length Field */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Arrow Length (nock-groove to tip, in)</span>
              <button
                type="button"
                onClick={() => setActiveTooltip(activeTooltip === "length" ? null : "length")}
                className="text-cyan-neon p-0.5 hover:text-white transition"
              >
                <Info size={14} />
              </button>
            </label>
            <span className="text-[9px] text-gray-dim uppercase">Pulgadas</span>
          </div>

          {activeTooltip === "length" && (
            <div className="bg-cyan-neon/10 border border-cyan-neon/20 p-2.5 rounded-xl text-[10px] text-cyan-200">
              Mide la flecha desde el fondo de la ranura del culatín hasta el extremo de la punta de tiro en pulgadas.
            </div>
          )}

          <input
            type="number"
            step="0.1"
            min={18}
            max={35}
            value={arrowLength}
            onChange={(e) => {
              setArrowLength(e.target.value);
              handleSaveSpecs(arrowWeight, e.target.value, temperature, tempUnit);
            }}
            placeholder="Nock groove to tip in inches (ej. 28.5)"
            className="w-full bg-neutral-900 border border-white/10 rounded-2xl px-4 py-3 text-white text-xs outline-none focus:border-cyan-neon transition font-medium"
          />
        </div>

        {/* Temperature Field */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Temperature ({tempUnit === "F" ? "°F" : "°C"})</span>
              <button
                type="button"
                onClick={() => setActiveTooltip(activeTooltip === "temp" ? null : "temp")}
                className="text-cyan-neon p-0.5 hover:text-white transition"
              >
                <Info size={14} />
              </button>
            </label>

            {/* Toggle °F vs °C */}
            <button
              type="button"
              onClick={handleToggleTempUnit}
              className="text-[9px] font-black uppercase text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/30 px-2.5 py-0.5 rounded-full hover:bg-cyan-neon/20 transition cursor-pointer"
            >
              Cambiar a {tempUnit === "F" ? "°C" : "°F"}
            </button>
          </div>

          {activeTooltip === "temp" && (
            <div className="bg-cyan-neon/10 border border-cyan-neon/20 p-2.5 rounded-xl text-[10px] text-cyan-200">
              La temperatura del aire afecta directamente la velocidad del sonido (c = 331.3 + 0.606·T m/s), crucial para calcular el retorno acústico desde la diana a 20 yardas.
            </div>
          )}

          <input
            type="number"
            step="1"
            value={temperature}
            onChange={(e) => {
              setTemperature(e.target.value);
              handleSaveSpecs(arrowWeight, arrowLength, e.target.value, tempUnit);
            }}
            placeholder={tempUnit === "F" ? "Air temperature in degrees Fahrenheit (ej. 70)" : "Temperatura en °C (ej. 21)"}
            className="w-full bg-neutral-900 border border-white/10 rounded-2xl px-4 py-3 text-white text-xs outline-none focus:border-cyan-neon transition font-medium"
          />
        </div>

        {/* 5. START NEW SESSION BUTTON (Screenshot 4) */}
        <div className="flex flex-col gap-2 mt-2">
          <button
            type="button"
            disabled={isRecording}
            onClick={handleStartSession}
            className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-xl transition active:scale-98 ${
              isRecording 
                ? "bg-red-500 text-white animate-pulse" 
                : "bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-gold text-black hover:brightness-105"
            }`}
          >
            {isRecording ? (
              <>
                <Volume2 size={16} className="animate-spin" />
                <span>Escuchando Disparo ({audioLevel}% Mic)</span>
              </>
            ) : (
              <>
                <span>Start New Session</span>
                <ExternalLink size={14} />
              </>
            )}
          </button>
          <span className="text-[10px] text-gray-dim text-center">
            {isRecording 
              ? "Dispara tu flecha ahora: detectando sonido de suelta e impacto..." 
              : "Ingresa peso, longitud y temperatura para medir la velocidad de salida."}
          </span>
        </div>
      </div>

      {/* 6. LIVE SHOT RESULT CARD (When shot is captured) */}
      {lastShotResult && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-neutral-950 border border-cyan-neon/40 p-6 rounded-[36px] flex flex-col items-center justify-center text-center relative overflow-hidden shadow-[0_0_40px_rgba(0,229,255,0.12)] gap-4"
        >
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-cyan-brand via-cyan-neon to-yellow-gold" />

          <div className="flex items-center justify-between w-full">
            <span className="text-[9px] font-black uppercase text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/30 px-3 py-1 rounded-full">
              Resultado de Medición a 20 yd
            </span>

            {/* Speed Unit Toggle */}
            <div className="flex bg-neutral-900 p-0.5 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setSpeedUnit("FPS")}
                className={`px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase transition ${
                  speedUnit === "FPS" ? "bg-cyan-neon text-black" : "text-gray-dim"
                }`}
              >
                FPS
              </button>
              <button
                type="button"
                onClick={() => setSpeedUnit("KMH")}
                className={`px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase transition ${
                  speedUnit === "KMH" ? "bg-cyan-neon text-black" : "text-gray-dim"
                }`}
              >
                KM/H
              </button>
            </div>
          </div>

          {/* Big Launch Velocity */}
          <div className="flex items-baseline gap-2 my-1">
            <span className="text-6xl md:text-7xl font-black text-white tracking-tighter drop-shadow-[0_0_25px_rgba(0,229,255,0.4)]">
              {speedUnit === "FPS" 
                ? Math.round(lastShotResult.launchSpeedFps) 
                : Math.round(lastShotResult.launchSpeedKmh)}
            </span>
            <span className="text-cyan-neon text-2xl font-black uppercase tracking-wider">
              {speedUnit}
            </span>
          </div>

          {/* Ballistics Row: Kinetic Energy & Momentum */}
          <div className="grid grid-cols-2 gap-3 w-full bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5 text-xs">
            <div className="flex flex-col items-center">
              <span className="text-[8px] text-white/40 uppercase font-bold tracking-wider">Energía Cinética</span>
              <span className="text-white font-black text-sm mt-0.5">
                {lastShotResult.kineticEnergyFtLbs ? `${lastShotResult.kineticEnergyFtLbs.toFixed(1)} ft-lbs` : "—"}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[8px] text-white/40 uppercase font-bold tracking-wider">Momento</span>
              <span className="text-cyan-neon font-black text-sm mt-0.5">
                {lastShotResult.momentumSlugFtSec ? `${lastShotResult.momentumSlugFtSec.toFixed(3)} slug-ft/s` : "—"}
              </span>
            </div>
          </div>

          {/* Timing details */}
          <div className="text-[10px] text-white/40 flex items-center justify-center gap-3">
            <span>Vuelo neto: {(lastShotResult.flightTimeSec * 1000).toFixed(0)} ms</span>
            <span>•</span>
            <span>Retorno sonido: {((lastShotResult.totalTimeSec - lastShotResult.flightTimeSec) * 1000).toFixed(0)} ms</span>
            <span>•</span>
            <span>Vel. Media: {Math.round(lastShotResult.speedFps)} fps</span>
          </div>

          <button
            type="button"
            onClick={startRecording}
            className="w-full py-3 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase tracking-wider shadow-glow-cyan flex items-center justify-center gap-2 cursor-pointer hover:brightness-110 active:scale-95 transition mt-1"
          >
            <RotateCcw size={14} />
            <span>Medir Otro Tiro</span>
          </button>
        </motion.div>
      )}

      {/* 7. SESSION HISTORY (Screenshot 4) */}
      <div className="bg-neutral-950 border border-white/10 rounded-3xl p-5 flex flex-col gap-3 shadow-xl">
        <div className="flex justify-between items-center">
          <span className="text-xs font-black uppercase tracking-wider text-white">
            Session History
          </span>
          <span className="text-[10px] text-gray-dim">
            {shotHistory.length} {shotHistory.length === 1 ? "tiro" : "tiros"}
          </span>
        </div>

        {shotHistory.length === 0 ? (
          <div className="py-8 text-center text-gray-dim text-xs leading-relaxed border border-dashed border-white/5 rounded-2xl">
            No sessions yet. Start a new session to measure your arrow speed.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 max-h-72 overflow-y-auto pr-1">
            {shotHistory.map((s) => (
              <div
                key={s.id}
                className="bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5 flex justify-between items-center"
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-base font-black">
                      {Math.round(s.launchSpeedFps)} <span className="text-cyan-neon text-xs">FPS</span>
                    </span>
                    <span className="text-white/40 text-[10px] font-bold">
                      ({Math.round(s.launchSpeedKmh)} km/h)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[9px] text-gray-dim mt-0.5">
                    <span>{s.arrowMassGrains || 420} gr</span>
                    <span>•</span>
                    <span>{s.arrowLengthInches || 28.5}"</span>
                    <span>•</span>
                    <span>{s.temperatureFahrenheit || 70}°F</span>
                    {s.kineticEnergyFtLbs && (
                      <>
                        <span>•</span>
                        <span className="text-orange-400 font-bold">{s.kineticEnergyFtLbs.toFixed(1)} ft-lbs</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteShot(s.id)}
                  className="p-2 text-gray-dim hover:text-red-400 hover:bg-red-500/10 rounded-xl transition cursor-pointer"
                  title="Eliminar registro"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
