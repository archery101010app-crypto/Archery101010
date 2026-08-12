"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  ArrowLeft, Mic, MicOff, Play, RefreshCw, Zap, Gauge, 
  Trash2, Plus, Minus, Info, Sparkles, Volume2, ShieldAlert
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { 
  calculateArrowSpeed, 
  calculateSpeedOfSound, 
  detectAudioPeaks, 
  ShotResult 
} from "@/lib/audioChronograph";

interface AcousticChronographViewProps {
  user: UserProfile;
  onBack: () => void;
}

export default function AcousticChronographView({ user, onBack }: AcousticChronographViewProps) {
  // Inputs
  const [distanceMeters, setDistanceMeters] = useState<number>(18);
  const [distanceUnit, setDistanceUnit] = useState<"m" | "yd">("m");
  const [customDistanceInput, setCustomDistanceInput] = useState<string>("18");
  const [temperatureCelsius, setTemperatureCelsius] = useState<number>(20);
  const [arrowMassGrains, setArrowMassGrains] = useState<number>(350);

  // Audio Recording & Analysis state
  const [isRecording, setIsRecording] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [releasePeakSec, setReleasePeakSec] = useState<number>(0.2);
  const [impactPeakSec, setImpactPeakSec] = useState<number>(0.52);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [recordingStatus, setRecordingStatus] = useState<"IDLE" | "LISTENING" | "ANALYZING" | "READY">("IDLE");

  // History logs
  const [shotHistory, setShotHistory] = useState<ShotResult[]>([]);

  // Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Distances options
  const presetDistances = [10, 18, 30, 50, 60, 70, 90];

  // Calculate current results dynamically based on release and impact peak timestamps
  const totalElapsed = Math.max(0.01, impactPeakSec - releasePeakSec);
  const currentDistanceMeters = distanceUnit === "yd" ? distanceMeters * 0.9144 : distanceMeters;
  const currentStats = calculateArrowSpeed(
    totalElapsed,
    currentDistanceMeters,
    temperatureCelsius,
    arrowMassGrains
  );

  // Load saved chronograph history from IndexedDB on mount
  useEffect(() => {
    async function loadLogs() {
      const { getLocalSetting } = await import("@/lib/db/indexedDB");
      const logs = await getLocalSetting<ShotResult[]>("chronograph_logs", []);
      setShotHistory(logs);
    }
    loadLogs();
  }, []);

  // Cleanup Web Audio API stream on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
      }
    };
  }, []);

  // Draw waveform on canvas whenever audioBuffer or peaks change
  useEffect(() => {
    if (!canvasRef.current || !audioBuffer) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const duration = audioBuffer.duration;

    ctx.clearRect(0, 0, width, height);

    // Draw background grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw Audio Waveform
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0, 229, 255, 0.6)";
    ctx.lineWidth = 1.5;

    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();

    // Draw Release Peak Line (Green/Cyan)
    const releaseX = (releasePeakSec / duration) * width;
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(releaseX, 0);
    ctx.lineTo(releaseX, height);
    ctx.stroke();

    ctx.fillStyle = "#00E5FF";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText("🎯 Disparo", releaseX + 4, 14);

    // Draw Impact Peak Line (Yellow/Gold)
    const impactX = (impactPeakSec / duration) * width;
    ctx.strokeStyle = "#FFF200";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(impactX, 0);
    ctx.lineTo(impactX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#FFF200";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText("🎯 Impacto", impactX + 4, height - 10);

  }, [audioBuffer, releasePeakSec, impactPeakSec]);

  // Start Audio Recording / Listening
  const startRecording = async () => {
    try {
      setRecordingStatus("LISTENING");
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

      // MediaRecorder for 3.5s shot window
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setRecordingStatus("ANALYZING");
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const arrayBuffer = await blob.arrayBuffer();
        
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          try {
            const decodedBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);
            setAudioBuffer(decodedBuffer);

            // Auto detect peaks
            const detected = detectAudioPeaks(decodedBuffer, currentDistanceMeters, temperatureCelsius);
            if (detected) {
              setReleasePeakSec(Math.round(detected.releaseSec * 1000) / 1000);
              setImpactPeakSec(Math.round(detected.impactSec * 1000) / 1000);
            } else {
              setReleasePeakSec(0.2);
              setImpactPeakSec(Math.round((0.2 + (currentDistanceMeters / 60) + (currentDistanceMeters / 343)) * 1000) / 1000);
            }
          } catch (err) {
            console.error("Audio decoding error:", err);
          }
        }
        setRecordingStatus("READY");
        setIsRecording(false);
      };

      mediaRecorder.start();

      // Automatically stop recording after 3.5 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          stopRecording();
        }
      }, 3500);

    } catch (err) {
      console.error("Microphone access error:", err);
      alert("No se pudo acceder al micrófono. Por favor permite los permisos de audio en tu navegador.");
      setIsRecording(false);
      setRecordingStatus("IDLE");
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

  // Save shot measurement to history
  const handleSaveShot = async () => {
    const newShot: ShotResult = {
      id: `SHOT-${Date.now()}`,
      timestamp: Date.now(),
      distanceMeters: currentDistanceMeters,
      distanceYards: currentDistanceMeters / 0.9144,
      temperatureCelsius,
      arrowMassGrains,
      totalTimeSec: totalElapsed,
      flightTimeSec: currentStats.flightTimeSec,
      speedMps: currentStats.speedMps,
      speedFps: currentStats.speedFps,
      speedKmh: currentStats.speedKmh,
      kineticEnergyFtLbs: currentStats.kineticEnergyFtLbs,
      momentumSlugFtSec: currentStats.momentumSlugFtSec,
      releasePeakSec,
      impactPeakSec
    };

    const updated = [newShot, ...shotHistory];
    setShotHistory(updated);

    const { saveLocalSetting } = await import("@/lib/db/indexedDB");
    await saveLocalSetting("chronograph_logs", updated);
  };

  // Delete shot from history
  const handleDeleteShot = async (id: string) => {
    const updated = shotHistory.filter((s) => s.id !== id);
    setShotHistory(updated);
    const { saveLocalSetting } = await import("@/lib/db/indexedDB");
    await saveLocalSetting("chronograph_logs", updated);
  };

  return (
    <div className="flex flex-col gap-5 max-w-xl mx-auto pb-10">
      {/* Top Bar Header */}
      <div className="flex items-center justify-between bg-neutral-900/60 p-3.5 rounded-3xl border border-white/10 backdrop-blur-md">
        <button
          onClick={onBack}
          className="p-2 rounded-2xl bg-neutral-950/80 border border-white/10 text-gray-dim hover:text-white transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-xs font-bold"
        >
          <ArrowLeft size={16} />
          <span>Volver</span>
        </button>

        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-xl bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon">
            <Gauge size={18} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-white font-black text-sm uppercase tracking-wider">Cronógrafo Acústico</h1>
            <span className="text-[9px] text-cyan-neon font-extrabold uppercase tracking-widest flex items-center gap-1">
              <Sparkles size={10} />
              Herramienta Exclusiva PRO
            </span>
          </div>
        </div>
      </div>

      {/* Main Digital Speedometer Speed Dial Card */}
      <div className="bg-neutral-950 border border-cyan-neon/30 p-6 rounded-[36px] flex flex-col items-center justify-center text-center relative overflow-hidden shadow-[0_0_40px_rgba(0,229,255,0.08)]">
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-cyan-brand via-cyan-neon to-yellow-gold" />
        
        {/* Speed Unit Display */}
        <div className="flex items-center gap-2 text-cyan-neon/80 text-[10px] font-black uppercase tracking-widest mb-1">
          <Zap size={14} className="text-yellow-gold animate-pulse" />
          <span>Velocidad Estimada de la Flecha</span>
        </div>

        {/* Large Speed Number */}
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-[0_0_20px_rgba(0,229,255,0.3)]">
            {Math.round(currentStats.speedFps)}
          </span>
          <span className="text-cyan-neon text-xl font-black uppercase tracking-wider">FPS</span>
        </div>

        {/* Secondary Speed Metrics (m/s & km/h) */}
        <div className="flex items-center gap-3 mt-1 px-4 py-1.5 rounded-full bg-neutral-900/80 border border-white/10 text-xs font-bold">
          <span className="text-white">{currentStats.speedMps.toFixed(1)} <span className="text-gray-dim text-[10px]">m/s</span></span>
          <span className="text-gray-border">•</span>
          <span className="text-white">{currentStats.speedKmh.toFixed(1)} <span className="text-gray-dim text-[10px]">km/h</span></span>
        </div>

        {/* Kinetic Energy & Flight Time */}
        <div className="grid grid-cols-2 gap-3 w-full mt-5 pt-4 border-t border-white/5 text-left">
          <div className="bg-neutral-900/40 p-2.5 rounded-2xl border border-white/5 flex flex-col">
            <span className="text-[9px] text-gray-dim font-bold uppercase">Tiempo de Vuelo Neto</span>
            <span className="text-white text-sm font-black mt-0.5">
              {(currentStats.flightTimeSec * 1000).toFixed(1)} <span className="text-[10px] text-cyan-neon">ms</span>
            </span>
          </div>

          <div className="bg-neutral-900/40 p-2.5 rounded-2xl border border-white/5 flex flex-col">
            <span className="text-[9px] text-gray-dim font-bold uppercase">Energía Cinética</span>
            <span className="text-yellow-gold text-sm font-black mt-0.5">
              {currentStats.kineticEnergyFtLbs ? currentStats.kineticEnergyFtLbs.toFixed(1) : "--"} <span className="text-[10px] text-gray-dim">ft-lbs</span>
            </span>
          </div>
        </div>
      </div>

      {/* Recording & Calibration Section */}
      <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic size={16} className={isRecording ? "text-cyan-neon animate-pulse" : "text-gray-dim"} />
            <span className="text-white text-xs font-black uppercase tracking-wider">Captura por Micrófono</span>
          </div>

          {/* Record Button */}
          <button
            type="button"
            disabled={isRecording}
            onClick={startRecording}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition active:scale-95 cursor-pointer shadow-glow-cyan ${
              isRecording 
                ? "bg-red-500 text-white animate-pulse" 
                : "bg-cyan-neon text-black hover:brightness-110"
            }`}
          >
            {isRecording ? (
              <>
                <Volume2 size={14} className="animate-spin" />
                <span>Escuchando ({audioLevel}%)</span>
              </>
            ) : (
              <>
                <Mic size={14} />
                <span>Grabar Tiro (3.5s)</span>
              </>
            )}
          </button>
        </div>

        {/* Audio Waveform Canvas */}
        <div className="flex flex-col gap-2">
          <div className="w-full h-32 bg-black-oled rounded-2xl border border-white/10 relative overflow-hidden flex items-center justify-center">
            {audioBuffer ? (
              <canvas ref={canvasRef} width={450} height={128} className="w-full h-full block" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-center p-4">
                <Mic size={24} className="text-gray-border animate-bounce" />
                <span className="text-[11px] text-gray-dim font-bold">Toca "Grabar Tiro" y dispara frente al teléfono</span>
                <span className="text-[9px] text-gray-border">Ubicación ideal: teléfono a 1m a la par del arco</span>
              </div>
            )}
          </div>

          {/* Peak Adjustment Fine Control */}
          {audioBuffer && (
            <div className="flex flex-col gap-2 bg-neutral-950 p-3 rounded-2xl border border-white/5">
              <span className="text-[9px] text-gray-dim font-black uppercase tracking-widest">Ajuste Fino de Picos de Sonido</span>
              
              <div className="grid grid-cols-2 gap-3 text-xs font-bold">
                {/* Release Adjustment */}
                <div className="flex items-center justify-between bg-neutral-900 p-2 rounded-xl border border-cyan-neon/30">
                  <span className="text-cyan-neon text-[10px]">Soltado: {(releasePeakSec * 1000).toFixed(0)}ms</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setReleasePeakSec(Math.max(0, releasePeakSec - 0.005))}
                      className="p-1 rounded bg-neutral-800 text-white hover:bg-neutral-700"
                    >
                      <Minus size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setReleasePeakSec(releasePeakSec + 0.005)}
                      className="p-1 rounded bg-neutral-800 text-white hover:bg-neutral-700"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>

                {/* Impact Adjustment */}
                <div className="flex items-center justify-between bg-neutral-900 p-2 rounded-xl border border-yellow-gold/30">
                  <span className="text-yellow-gold text-[10px]">Impacto: {(impactPeakSec * 1000).toFixed(0)}ms</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setImpactPeakSec(Math.max(releasePeakSec + 0.05, impactPeakSec - 0.005))}
                      className="p-1 rounded bg-neutral-800 text-white hover:bg-neutral-700"
                    >
                      <Minus size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setImpactPeakSec(impactPeakSec + 0.005)}
                      className="p-1 rounded bg-neutral-800 text-white hover:bg-neutral-700"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Shot Settings Setup Card */}
      <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/10 flex flex-col gap-4">
        <h3 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
          <Info size={14} className="text-cyan-neon" />
          Parámetros de Tiro
        </h3>

        {/* Distance Selector */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center text-[10px]">
            <span className="text-gray-dim font-bold uppercase">Distancia al Blanco</span>
            <div className="flex bg-neutral-950 p-0.5 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setDistanceUnit("m")}
                className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${distanceUnit === "m" ? "bg-cyan-neon text-black" : "text-gray-dim"}`}
              >
                Metros
              </button>
              <button
                type="button"
                onClick={() => setDistanceUnit("yd")}
                className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${distanceUnit === "yd" ? "bg-cyan-neon text-black" : "text-gray-dim"}`}
              >
                Yardas
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {presetDistances.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDistanceMeters(d);
                  setCustomDistanceInput(d.toString());
                }}
                className={`py-2 rounded-xl text-xs font-bold transition border ${
                  distanceMeters === d 
                    ? "bg-cyan-neon/10 border-cyan-neon text-cyan-neon shadow-glow-cyan" 
                    : "bg-neutral-950/60 border-white/5 text-gray-dim hover:text-white"
                }`}
              >
                {d}{distanceUnit}
              </button>
            ))}
          </div>
        </div>

        {/* Temperature & Arrow Weight inputs */}
        <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-dim font-bold uppercase">Temperatura (°C)</label>
            <input
              type="number"
              value={temperatureCelsius}
              onChange={(e) => setTemperatureCelsius(Number(e.target.value))}
              className="bg-neutral-950 border border-white/10 rounded-xl p-2.5 text-white text-xs font-bold outline-none focus:border-cyan-neon"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-dim font-bold uppercase">Peso Flecha (Grains)</label>
            <input
              type="number"
              value={arrowMassGrains}
              onChange={(e) => setArrowMassGrains(Number(e.target.value))}
              className="bg-neutral-950 border border-white/10 rounded-xl p-2.5 text-white text-xs font-bold outline-none focus:border-cyan-neon"
            />
          </div>
        </div>

        {/* Save Result Button */}
        <button
          type="button"
          onClick={handleSaveShot}
          className="w-full py-3 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase tracking-wider cursor-pointer hover:brightness-110 transition shadow-glow-cyan active:scale-95 mt-1"
        >
          Guardar Tiro en Historial
        </button>
      </div>

      {/* Shot History Log Table */}
      {shotHistory.length > 0 && (
        <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/10 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-white text-xs font-black uppercase tracking-wider">Historial de Mediciones ({shotHistory.length})</span>
          </div>

          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
            {shotHistory.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 rounded-2xl bg-neutral-950/80 border border-white/5">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-neon text-sm font-black">{Math.round(s.speedFps)} FPS</span>
                    <span className="text-white/60 text-[10px] font-bold">({s.speedMps.toFixed(1)} m/s)</span>
                  </div>
                  <span className="text-[9px] text-gray-dim">
                    {s.distanceMeters}m • {s.temperatureCelsius}°C {s.kineticEnergyFtLbs ? `• ${s.kineticEnergyFtLbs.toFixed(1)} ft-lbs` : ""}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteShot(s.id)}
                  className="p-2 rounded-xl text-gray-dim hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
