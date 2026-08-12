"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  ArrowLeft, Mic, Gauge, Trash2, Sparkles, Volume2, Target
} from "lucide-react";
import { UserProfile } from "@/lib/authService";
import { 
  calculateArrowSpeed, 
  detectAudioPeaks, 
  ShotResult 
} from "@/lib/audioChronograph";

interface AcousticChronographViewProps {
  user: UserProfile;
  onBack: () => void;
}

export default function AcousticChronographView({ user, onBack }: AcousticChronographViewProps) {
  // Fixed distance for Target Archery Test (5 meters)
  const distanceMeters = 5;
  const temperatureCelsius = 20;

  // Display Unit Toggle: FPS vs KMH
  const [speedUnit, setSpeedUnit] = useState<"FPS" | "KMH">("FPS");

  // Audio Recording & Analysis state
  const [isRecording, setIsRecording] = useState(false);
  const [releasePeakSec, setReleasePeakSec] = useState<number>(0.15);
  const [impactPeakSec, setImpactPeakSec] = useState<number>(0.24);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // History logs
  const [shotHistory, setShotHistory] = useState<ShotResult[]>([]);

  // Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Calculate current results dynamically
  const totalElapsed = Math.max(0.01, impactPeakSec - releasePeakSec);
  const currentStats = calculateArrowSpeed(
    totalElapsed,
    distanceMeters,
    temperatureCelsius
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

  // Start Audio Recording / Listening
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

      // MediaRecorder for 2.5s shot window
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

            // Auto detect peaks
            const detected = detectAudioPeaks(decodedBuffer, distanceMeters, temperatureCelsius);
            if (detected) {
              setReleasePeakSec(Math.round(detected.releaseSec * 1000) / 1000);
              setImpactPeakSec(Math.round(detected.impactSec * 1000) / 1000);
            } else {
              setReleasePeakSec(0.15);
              setImpactPeakSec(Math.round((0.15 + (5 / 65) + (5 / 343)) * 1000) / 1000);
            }
          } catch (err) {
            console.error("Audio decoding error:", err);
          }
        }
        setIsRecording(false);
      };

      mediaRecorder.start();

      // Automatically stop recording after 2.5 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          stopRecording();
        }
      }, 2500);

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

  // Save shot measurement to history
  const handleSaveShot = async () => {
    const newShot: ShotResult = {
      id: `SHOT-${Date.now()}`,
      timestamp: Date.now(),
      distanceMeters: 5,
      distanceYards: 5.46,
      temperatureCelsius: 20,
      totalTimeSec: totalElapsed,
      flightTimeSec: currentStats.flightTimeSec,
      speedMps: currentStats.speedMps,
      speedFps: currentStats.speedFps,
      speedKmh: currentStats.speedKmh,
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
              Prueba a 5m (Target Archery)
            </span>
          </div>
        </div>
      </div>

      {/* Unified Master Speedometer & Recording Card */}
      <div className="bg-neutral-950 border border-cyan-neon/30 p-6 rounded-[36px] flex flex-col items-center justify-center text-center relative overflow-hidden shadow-[0_0_40px_rgba(0,229,255,0.08)] gap-4">
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-cyan-brand via-cyan-neon to-yellow-gold" />

        {/* Distance Badge & Unit Switcher */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5 bg-cyan-neon/10 border border-cyan-neon/30 text-cyan-neon font-black px-3 py-1 rounded-full text-[10px] uppercase tracking-wider">
            <Target size={12} />
            <span>Distancia: 5 Metros</span>
          </div>

          {/* Unit Toggle Option: FPS vs KM/H */}
          <div className="flex bg-neutral-900 p-0.5 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setSpeedUnit("FPS")}
              className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition cursor-pointer ${
                speedUnit === "FPS" 
                  ? "bg-cyan-neon text-black shadow-glow-cyan" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              FPS
            </button>
            <button
              type="button"
              onClick={() => setSpeedUnit("KMH")}
              className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition cursor-pointer ${
                speedUnit === "KMH" 
                  ? "bg-cyan-neon text-black shadow-glow-cyan" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              KM/H
            </button>
          </div>
        </div>

        {/* Big Speed Number */}
        <div className="flex items-baseline gap-2 my-2">
          <span className="text-6xl md:text-7xl font-black text-white tracking-tighter drop-shadow-[0_0_25px_rgba(0,229,255,0.35)]">
            {speedUnit === "FPS" 
              ? Math.round(currentStats.speedFps) 
              : Math.round(currentStats.speedKmh)}
          </span>
          <span className="text-cyan-neon text-2xl font-black uppercase tracking-wider">
            {speedUnit}
          </span>
        </div>

        {/* Secondary Speed Info */}
        <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-neutral-900/80 border border-white/10 text-xs font-bold">
          {speedUnit === "FPS" ? (
            <>
              <span className="text-white">{currentStats.speedKmh.toFixed(1)} <span className="text-gray-dim text-[10px]">km/h</span></span>
              <span className="text-gray-border">•</span>
              <span className="text-white">{currentStats.speedMps.toFixed(1)} <span className="text-gray-dim text-[10px]">m/s</span></span>
            </>
          ) : (
            <>
              <span className="text-white">{Math.round(currentStats.speedFps)} <span className="text-gray-dim text-[10px]">FPS</span></span>
              <span className="text-gray-border">•</span>
              <span className="text-white">{currentStats.speedMps.toFixed(1)} <span className="text-gray-dim text-[10px]">m/s</span></span>
            </>
          )}
        </div>

        {/* Concentrated Action Buttons Inside Card */}
        <div className="flex flex-col gap-2.5 w-full mt-2 pt-4 border-t border-white/5">
          {/* Main Button: Medir Velocidad */}
          <button
            type="button"
            disabled={isRecording}
            onClick={startRecording}
            className={`w-full py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer shadow-glow-cyan ${
              isRecording 
                ? "bg-red-500 text-white animate-pulse" 
                : "bg-cyan-neon text-black hover:brightness-110"
            }`}
          >
            {isRecording ? (
              <>
                <Volume2 size={16} className="animate-spin" />
                <span>Escuchando Disparo a 5m ({audioLevel}%)</span>
              </>
            ) : (
              <>
                <Mic size={16} />
                <span>Medir Velocidad</span>
              </>
            )}
          </button>

          {/* Secondary Button: Guardar Tiro en Historial */}
          <button
            type="button"
            onClick={handleSaveShot}
            className="w-full py-3 rounded-2xl bg-neutral-900 border border-white/10 text-white font-bold text-xs uppercase tracking-wider cursor-pointer hover:bg-neutral-800 transition active:scale-95"
          >
            Guardar Tiro en Historial
          </button>
        </div>
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
                    <span className="text-cyan-neon text-base font-black">
                      {speedUnit === "FPS" ? `${Math.round(s.speedFps)} FPS` : `${Math.round(s.speedKmh)} KM/H`}
                    </span>
                    <span className="text-white/60 text-[10px] font-bold">
                      ({s.speedMps.toFixed(1)} m/s / {speedUnit === "FPS" ? `${Math.round(s.speedKmh)} km/h` : `${Math.round(s.speedFps)} FPS`})
                    </span>
                  </div>
                  <span className="text-[9px] text-gray-dim">
                    Distancia Fija: 5 Metros
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
