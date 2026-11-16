"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { ShieldAlert, RefreshCw, Home, RotateCcw } from "lucide-react";
import { reportClientError, initGlobalCrashHandlers } from "@/lib/crashReporter";

interface Props {
  children: ReactNode;
  sectionName?: string;
  compact?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public componentDidMount() {
    initGlobalCrashHandlers();
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
    reportClientError(error, this.props.sectionName || "root");

    const isSubView = Boolean(this.props.sectionName || this.props.compact);
    const msg = error?.toString() || "";
    if (
      !isSubView &&
      typeof window !== "undefined" &&
      (msg.includes("ChunkLoadError") || msg.includes("Failed to load chunk"))
    ) {
      try {
        const reloadedKey = "chunk_reload_attempted";
        if (!sessionStorage.getItem(reloadedKey)) {
          sessionStorage.setItem(reloadedKey, "1");
          this.handleReload();
        }
      } catch {
        // ignore
      }
    }
  }

  private handleRetryModule = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleReload = async () => {
    if (typeof window !== "undefined") {
      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.update()));
        }
      } catch {
        // ignore
      }
      window.location.href = `${window.location.origin}/?v=${Date.now()}`;
    }
  };

  private handleReset = () => {
    if (typeof window !== "undefined") {
      window.location.href = window.location.origin;
    }
  };

  public render() {
    if (this.state.hasError) {
      // Sub-view / module boundary: inline Matte OLED recovery card without wiping caches or killing the app
      if (this.props.sectionName || this.props.compact) {
        return (
          <div
            role="alert"
            className={`w-full bg-[#07090E] border border-white/[0.08] rounded-3xl ${
              this.props.compact ? "p-4 gap-3" : "p-5 gap-4"
            } flex flex-col items-center text-center text-white my-2`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#12151C] border border-white/[0.10] flex items-center justify-center text-cyan-neon shrink-0">
                <ShieldAlert size={18} />
              </div>
              <div className="text-left">
                <h3 className="text-white text-sm font-black tracking-tight">
                  {this.props.sectionName
                    ? `Pausa temporal en ${this.props.sectionName}`
                    : "Error puntual en este módulo"}
                </h3>
                <p className="text-[11.5px] text-white leading-snug">
                  Tus datos locales siguen protegidos. Reintenta cargar el módulo.
                </p>
              </div>
            </div>

            {!this.props.compact && this.state.error && (
              <div className="w-full bg-[#020305] border border-white/[0.08] rounded-2xl px-3 py-2 text-[11px] font-sans tabular-nums text-left max-h-[72px] overflow-y-auto">
                <span className="text-white break-all">
                  {this.state.error.message || this.state.error.toString()}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={this.handleRetryModule}
              className="w-full sm:w-auto px-5 h-10 bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer active:scale-[0.98] transition flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} />
              <span>Reintentar módulo</span>
            </button>
          </div>
        );
      }

      return (
        <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 bg-black-oled text-white relative overflow-hidden">
          {/* Clean Editorial Alert Box */}
          <div className="w-full max-w-sm bg-[#0B0D12] border border-white/[0.08] rounded-3xl p-6 flex flex-col items-center gap-5 shadow-2xl relative z-10">
            <div className="w-12 h-12 rounded-2xl bg-white border border-white flex items-center justify-center text-black">
              <ShieldAlert size={22} />
            </div>

            {/* Typography Description */}
            <div className="text-center flex flex-col gap-1">
              <h2 className="text-white text-[17.6px] font-black tracking-tight">
                Error de visualización
              </h2>
              <p className="text-xs text-white leading-relaxed px-2 mt-1">
                Ocurrió un problema inesperado al cargar esta vista. Puedes reintentar, recargar la página o regresar al inicio.
              </p>
            </div>

            {/* Debug Code Block */}
            <div className="w-full bg-[#0D1017] border border-white/[0.06] rounded-2xl p-3.5 flex flex-col gap-1 text-[11.6px] tabular-nums text-left max-h-[110px] overflow-y-auto scrollbar-thin">
              <span className="inline-block w-fit px-2 py-0.5 rounded bg-white text-black font-black text-[10px] uppercase">Detalle técnico:</span>
              <span className="text-white break-all">{this.state.error?.toString() || "Error desconocido"}</span>
            </div>

            {/* Control CTAs */}
            <div className="w-full flex flex-col gap-2">
              <button
                type="button"
                onClick={this.handleRetryModule}
                className="w-full h-11 bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-widest rounded-2xl cursor-pointer active:scale-[0.99] transition flex items-center justify-center gap-2"
              >
                <RotateCcw size={14} />
                <span>Reintentar módulo</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="w-full h-11 bg-[#12151C] border border-white/[0.10] text-white font-black text-xs uppercase tracking-widest rounded-2xl cursor-pointer active:scale-[0.99] transition flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} />
                <span>Recargar aplicación</span>
              </button>
              
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full h-11 bg-[#0D1017] border border-white/[0.08] text-white hover:text-white font-bold text-xs uppercase tracking-wider rounded-2xl cursor-pointer transition flex items-center justify-center gap-2"
              >
                <Home size={14} />
                <span>Volver al Inicio</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
