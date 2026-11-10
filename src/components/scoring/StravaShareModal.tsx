"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, MessageCircle, X, Camera, ImagePlus, Circle, Layers, RefreshCw } from "lucide-react";
import {
  ShareTargetResult,
  renderTargetShotChartCanvas,
  triggerNativeImageShare
} from "@/lib/scoring/targetImageGenerator";

interface StravaShareModalProps {
  shareResult: ShareTargetResult | null;
  onClose: () => void;
}

type ActiveButtonTab = "black" | "transparent" | "upload" | "camera";

export default function StravaShareModal({ shareResult, onClose }: StravaShareModalProps) {
  const [activeTab, setActiveTab] = useState<ActiveButtonTab>("black");
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
  const [cameraPhotoUrl, setCameraPhotoUrl] = useState<string | null>(null);
  const [activeDataUrl, setActiveDataUrl] = useState<string>("");
  const [isRendering, setIsRendering] = useState<boolean>(false);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (shareResult) {
      setActiveTab("black");
      setUploadedPhotoUrl(shareResult.params?.backgroundPhotoUrl || null);
      setCameraPhotoUrl(null);
      setActiveDataUrl(shareResult.dataUrl);
    }
  }, [shareResult]);

  // Listen for native Android camera capture result (from MainActivity.java)
  useEffect(() => {
    const handleNativeCameraPhoto = (event: Event) => {
      const customEvent = event as CustomEvent<{ dataUrl?: string }>;
      const dataUrl = customEvent.detail?.dataUrl;
      if (dataUrl && typeof dataUrl === "string") {
        setCameraPhotoUrl(dataUrl);
        setActiveTab("camera");
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("archery-native-camera-photo", handleNativeCameraPhoto);
      return () => {
        window.removeEventListener("archery-native-camera-photo", handleNativeCameraPhoto);
      };
    }
  }, []);

  const currentPhotoUrl =
    activeTab === "camera"
      ? cameraPhotoUrl || uploadedPhotoUrl
      : uploadedPhotoUrl || cameraPhotoUrl;

  useEffect(() => {
    if (!shareResult?.params) return;
    let cancelled = false;

    const regenerateCard = async () => {
      setIsRendering(true);
      try {
        const isPhotoDesign =
          (activeTab === "upload" || activeTab === "camera") && Boolean(currentPhotoUrl);
        const resolvedThemeMode =
          activeTab === "transparent"
            ? "transparent"
            : isPhotoDesign
            ? "photo"
            : "black";

        const canvas = await renderTargetShotChartCanvas({
          ...shareResult.params,
          themeMode: resolvedThemeMode,
          backgroundPhotoUrl: isPhotoDesign ? currentPhotoUrl : null
        });
        if (!cancelled) {
          setActiveDataUrl(canvas.toDataURL("image/png"));
        }
      } catch (err) {
        console.error("Error rendering telemetry card:", err);
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    };

    regenerateCard();
    return () => {
      cancelled = true;
    };
  }, [activeTab, currentPhotoUrl, shareResult]);

  if (!shareResult) return null;

  const currentDataUrl = activeDataUrl || shareResult.dataUrl;

  const handleUploadPhotoClick = () => {
    if (uploadedPhotoUrl) {
      setActiveTab("upload");
      return;
    }
    uploadInputRef.current?.click();
  };

  const handleChangeUploadedPhotoClick = () => {
    uploadInputRef.current?.click();
  };

  const handleTakeCameraPhotoClick = () => {
    if (typeof window !== "undefined" && window.ArcheryNativeShare?.takeCameraPhoto) {
      try {
        window.ArcheryNativeShare.takeCameraPhoto();
        return;
      } catch (err) {
        console.error("Native takeCameraPhoto error:", err);
      }
    }
    cameraInputRef.current?.click();
  };

  const handlePhotoFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    sourceTab: "upload" | "camera"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        if (sourceTab === "camera") {
          setCameraPhotoUrl(reader.result);
        } else {
          setUploadedPhotoUrl(reader.result);
        }
        setActiveTab(sourceTab);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const getModeSuffix = () => {
    if (activeTab === "transparent") return "-Transparente";
    if (activeTab === "upload") return "-Foto";
    if (activeTab === "camera") return "-Camara";
    return "";
  };

  const handleNativeShareAgain = async () => {
    const { fileName, captionText } = shareResult;
    const outFileName = fileName.replace(/\.png$/i, `${getModeSuffix()}.png`);
    await triggerNativeImageShare(currentDataUrl, outFileName, "ARCHERY 101010 THE APP", captionText);
  };

  const handleWhatsAppShare = async () => {
    const { fileName, captionText } = shareResult;
    const outFileName = fileName.replace(/\.png$/i, `${getModeSuffix()}.png`);

    if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareWhatsAppImage) {
      window.ArcheryNativeShare.shareWhatsAppImage(currentDataUrl, outFileName, captionText);
      return;
    }

    try {
      const res = await fetch(currentDataUrl);
      const blob = await res.blob();
      const file = new File([blob], outFileName, { type: "image/png" });
      if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "ARCHERY 101010 THE APP",
          text: captionText
        });
        return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
    }

    window.location.href = `whatsapp://send?text=${encodeURIComponent(captionText)}`;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200000] bg-black/94 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-hidden overscroll-contain"
      >
        <div className="w-full max-w-sm max-h-[92dvh] overflow-y-auto overscroll-contain flex flex-col items-center justify-between gap-1.5">
          {/* Gallery File Picker (Sube Foto) */}
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handlePhotoFileChange(e, "upload")}
            className="hidden"
          />

          {/* Direct Camera Capture Fallback for Mobile Browsers (Toma Foto) */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => handlePhotoFileChange(e, "camera")}
            className="hidden"
          />

          {/* Top Bar: Official ARCHERY 101010 Brand Header */}
          <div className="w-full flex items-center justify-between py-1 shrink-0">
            <div className="flex flex-col gap-1 min-w-0">
              <img
                src="/images/brand_logo_header.png"
                srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                alt="ARCHERY 101010"
                className="h-5 w-auto object-contain select-none self-start"
              />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/85 truncate">
                Telemetría Oficial · Lista para Compartir
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          {/* 4-Mode Selector Bar: Fondo Negro | Fondo Transparente | Sube Foto | Toma Foto */}
          <div className="w-full flex flex-col gap-1.5 my-1 shrink-0">
            <div className="grid grid-cols-2 gap-1.5 bg-[#0A0E17] p-1.5 rounded-2xl border border-white/12">
              <button
                type="button"
                onClick={() => setActiveTab("black")}
                className={`h-9 px-2 rounded-xl text-[9.5px] sm:text-[10px] font-black uppercase tracking-wide flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap min-w-0 ${
                  activeTab === "black"
                    ? "bg-white text-[#04060A] shadow-sm"
                    : "bg-transparent text-white/75 hover:text-white"
                }`}
              >
                <Circle size={10} className={`shrink-0 ${activeTab === "black" ? "fill-current" : ""}`} />
                <span className="truncate">Fondo Negro</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("transparent")}
                className={`h-9 px-2 rounded-xl text-[9.5px] sm:text-[10px] font-black uppercase tracking-wide flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap min-w-0 ${
                  activeTab === "transparent"
                    ? "bg-white text-[#04060A] shadow-sm"
                    : "bg-transparent text-white/75 hover:text-white"
                }`}
              >
                <Layers size={11.5} strokeWidth={2.5} className="shrink-0" />
                <span className="truncate">Fondo Transparente</span>
              </button>

              <button
                type="button"
                onClick={handleUploadPhotoClick}
                className={`h-9 px-2 rounded-xl text-[9.5px] sm:text-[10px] font-black uppercase tracking-wide flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap min-w-0 ${
                  activeTab === "upload"
                    ? "bg-white text-[#04060A] shadow-sm"
                    : "bg-transparent text-white/75 hover:text-white"
                }`}
              >
                <ImagePlus size={12} strokeWidth={2.5} className="shrink-0" />
                <span className="truncate">Sube Foto</span>
              </button>

              <button
                type="button"
                onClick={handleTakeCameraPhotoClick}
                className={`h-9 px-2 rounded-xl text-[9.5px] sm:text-[10px] font-black uppercase tracking-wide flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap min-w-0 ${
                  activeTab === "camera"
                    ? "bg-white text-[#04060A] shadow-sm"
                    : "bg-transparent text-white/75 hover:text-white"
                }`}
              >
                <Camera size={12} strokeWidth={2.5} className="shrink-0" />
                <span className="truncate">Toma Foto</span>
              </button>
            </div>

            {activeTab === "upload" && uploadedPhotoUrl && (
              <button
                type="button"
                onClick={handleChangeUploadedPhotoClick}
                className="self-center px-3 py-1.5 rounded-xl bg-[#12151C] hover:bg-white/10 border border-white/12 text-[10px] font-black uppercase tracking-wider text-cyan-neon flex items-center gap-1.5 transition cursor-pointer"
              >
                <RefreshCw size={11} strokeWidth={2.5} />
                <span className="truncate">Cambiar foto</span>
              </button>
            )}
          </div>

          {/* Center Preview Card (Vertical 9:16 Proportion) */}
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={
              activeTab === "transparent"
                ? {
                    backgroundImage:
                      "linear-gradient(45deg, #11151D 25%, transparent 25%), linear-gradient(-45deg, #11151D 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #11151D 75%), linear-gradient(-45deg, transparent 75%, #11151D 75%)",
                    backgroundSize: "18px 18px",
                    backgroundPosition: "0 0, 0 9px, 9px -9px, -9px 0",
                    backgroundColor: "#080A0F"
                  }
                : undefined
            }
            className="relative w-fit max-w-[290px] sm:max-w-[315px] mx-auto my-1 rounded-3xl overflow-hidden border border-white/15 bg-[#05070B] shadow-[0_16px_48px_rgba(0,0,0,0.85)] shrink-0"
          >
            <img
              src={currentDataUrl}
              alt="ARCHERY 101010 THE APP Telemetría"
              className={`max-h-[42dvh] w-auto mx-auto object-contain block select-none transition-opacity duration-150 ${
                isRendering ? "opacity-60" : "opacity-100"
              }`}
            />
          </motion.div>

          {/* Action Buttons */}
          <div className="w-full flex flex-col gap-2 pt-1 pb-1 shrink-0">
            <button
              type="button"
              onClick={handleNativeShareAgain}
              className="w-full h-11 px-3 rounded-xl bg-white hover:bg-neutral-200 text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition"
            >
              <Share2 size={16} strokeWidth={2.4} className="shrink-0" />
              <span className="truncate">Compartir Imagen (Redes Sociales)</span>
            </button>

            <button
              type="button"
              onClick={handleWhatsAppShare}
              className="w-full h-11 px-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition"
            >
              <MessageCircle size={16} className="text-emerald-400 shrink-0" strokeWidth={2.4} />
              <span className="truncate">Enviar Foto + Planilla</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full h-9 rounded-xl bg-transparent hover:bg-white/[0.05] text-white/75 hover:text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center cursor-pointer transition"
            >
              Cerrar Vista Previa
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
