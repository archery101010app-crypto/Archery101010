"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { ShieldAlert, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
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

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    if (typeof window !== "undefined") {
      window.location.href = window.location.origin;
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 bg-black-oled text-white relative overflow-hidden">
          {/* Ambient neon backgrounds */}
          <div className="absolute top-[-20%] left-[-20%] w-[80%] aspect-square rounded-full bg-red-rival/10 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-20%] w-[80%] aspect-square rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />

          {/* Premium Alert Box */}
          <div className="w-full max-w-sm bg-neutral-950 border border-red-rival/20 rounded-[32px] p-6 flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(239,68,68,0.05)] relative z-10">
            {/* Pulsing Warning Icon Container */}
            <div className="w-16 h-16 rounded-full bg-red-rival/10 border border-red-rival/25 flex items-center justify-center text-red-rival shadow-[0_0_30px_rgba(239,68,68,0.15)] animate-pulse">
              <ShieldAlert size={28} />
            </div>

            {/* Typography Description */}
            <div className="text-center flex flex-col gap-1.5">
              <h2 className="text-white text-base font-black uppercase tracking-wider">
                Algo salió mal en la vista
              </h2>
              <p className="text-[10px] text-red-rival uppercase tracking-widest font-black">
                Error de Renderizado Detectado
              </p>
              <p className="text-xs text-gray-dim leading-relaxed px-2 mt-1">
                La aplicación experimentó un fallo inesperado de visualización. Puedes recargar la página o regresar al panel de inicio.
              </p>
            </div>

            {/* Debug Code Block */}
            <div className="w-full bg-neutral-900/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-1 text-[10px] font-mono text-left max-h-[120px] overflow-y-auto scrollbar-thin">
              <span className="text-red-rival font-bold">Detalles:</span>
              <span className="text-gray-300 break-all">{this.state.error?.toString() || "Error desconocido"}</span>
              {this.state.errorInfo?.componentStack && (
                <span className="text-gray-dim whitespace-pre-wrap mt-1 opacity-60">
                  {this.state.errorInfo.componentStack.split("\n").slice(0, 3).join("\n")}
                </span>
              )}
            </div>

            {/* Control CTAs */}
            <div className="w-full flex flex-col gap-2.5">
              <button
                onClick={this.handleReload}
                className="w-full py-3.5 bg-gradient-to-r from-red-rival/80 to-purple-600/80 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:brightness-105 active:scale-98 transition flex items-center justify-center gap-2 border border-red-rival/20 shadow-[0_0_15px_rgba(239,68,68,0.08)]"
              >
                <RefreshCw size={14} className="animate-spin" style={{ animationDuration: "3s" }} />
                <span>Recargar Aplicación</span>
              </button>
              
              <button
                onClick={this.handleReset}
                className="w-full py-3.5 bg-neutral-900 border border-white/10 text-gray-dim hover:text-white font-bold text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:bg-neutral-800 transition flex items-center justify-center gap-2"
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
