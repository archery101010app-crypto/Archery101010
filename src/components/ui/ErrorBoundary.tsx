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
          {/* Clean Editorial Alert Box */}
          <div className="w-full max-w-sm bg-[#0B0D12] border border-white/[0.08] rounded-3xl p-6 flex flex-col items-center gap-5 shadow-2xl relative z-10">
            <div className="w-12 h-12 rounded-2xl bg-red-rival/10 border border-red-rival/25 flex items-center justify-center text-red-rival">
              <ShieldAlert size={22} />
            </div>

            {/* Typography Description */}
            <div className="text-center flex flex-col gap-1">
              <h2 className="text-white text-[17.6px] font-black tracking-tight">
                Error de visualización
              </h2>
              <p className="text-xs text-white leading-relaxed px-2 mt-1">
                Ocurrió un problema inesperado al cargar esta vista. Puedes recargar la página o regresar al inicio.
              </p>
            </div>

            {/* Debug Code Block */}
            <div className="w-full bg-[#0D1017] border border-white/[0.06] rounded-2xl p-3.5 flex flex-col gap-1 text-[11.6px] tabular-nums text-left max-h-[110px] overflow-y-auto scrollbar-thin">
              <span className="text-red-rival font-bold">Detalle técnico:</span>
              <span className="text-white break-all">{this.state.error?.toString() || "Error desconocido"}</span>
            </div>

            {/* Control CTAs */}
            <div className="w-full flex flex-col gap-2">
              <button
                onClick={this.handleReload}
                className="w-full h-11 bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-widest rounded-2xl cursor-pointer active:scale-[0.99] transition flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} />
                <span>Recargar</span>
              </button>
              
              <button
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
