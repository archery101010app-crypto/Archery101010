"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import {
  BleHeartRateStatus,
  connectBleHeartRateDevice,
  disconnectBleHeartRateDevice,
  getBleHeartRateStatus,
  startBleHeartRateScanOrRequest,
  stopBleHeartRateScan,
  subscribeBleHeartRate
} from "@/lib/scoring/bleHeartRateService";

interface BleHeartRateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BleHeartRateModal({ isOpen, onClose }: BleHeartRateModalProps) {
  const { t, tx } = useLanguage();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  const [status, setStatus] = useState<BleHeartRateStatus>(() => getBleHeartRateStatus());

  useEffect(() => {
    return subscribeBleHeartRate((next) => {
      setStatus(next);
    });
  }, []);

  // Open/close native <dialog> via showModal() + light-dismiss fallback + mobile back stack
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      dialog.returnValue = "";
      stopBleHeartRateScan();
      onCloseRef.current();
    };

    dialog.addEventListener("close", handleNativeClose);

    // Fallback for browsers without native <dialog closedby="any"> support
    let removeLightDismissFallback: (() => void) | null = null;
    if (
      typeof HTMLDialogElement !== "undefined" &&
      !("closedBy" in HTMLDialogElement.prototype)
    ) {
      const onBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isInsideDialog =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!isInsideDialog && dialog.open) {
          dialog.close();
        }
      };
      dialog.addEventListener("click", onBackdropClick);
      removeLightDismissFallback = () => dialog.removeEventListener("click", onBackdropClick);
    }

    return () => {
      dialog.removeEventListener("close", handleNativeClose);
      if (removeLightDismissFallback) removeLightDismissFallback();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {}
      }
      // On native Android, start discovery automatically when opened if not yet connected
      const current = getBleHeartRateStatus();
      if (
        current.transport === "native_android" &&
        current.state !== "connected" &&
        current.state !== "connecting" &&
        current.state !== "scanning"
      ) {
        startBleHeartRateScanOrRequest();
      }
      const unregisterBack = registerModalDismiss(() => {
        if (dialog.open) {
          dialog.close();
        } else {
          onCloseRef.current();
        }
      });
      return () => {
        unregisterBack();
      };
    } else if (dialog.open) {
      stopBleHeartRateScan();
      dialog.close();
    }
  }, [isOpen]);

  const handleCloseClick = () => {
    stopBleHeartRateScan();
    if (dialogRef.current?.open) {
      dialogRef.current.close();
    } else {
      onClose();
    }
  };

  const isConnected = status.state === "connected";
  const isScanning = status.state === "scanning";
  const isConnecting = status.state === "connecting" || status.state === "reconnecting";

  const statusBadgeText = isConnected
    ? tx("EN VIVO", "LIVE")
    : isConnecting
    ? tx("CONECTANDO", "CONNECTING")
    : isScanning
    ? t("bleHrScanning")
    : tx("EN ESPERA", "STANDBY");

  const errorBannerMessage = (() => {
    if (!status.errorCode) return "";
    if (status.errorCode === "HR_BROADCAST_NOT_ENABLED") {
      return tx(
        "Este dispositivo está cerca pero aún no transmite pulso. Activa «Transmitir frecuencia cardíaca» en los ajustes de tu pulsera o banda y vuelve a conectar.",
        "This device is nearby but not broadcasting heart rate yet. Enable Heart Rate Broadcast in your band or strap settings and reconnect."
      );
    }
    if (status.errorCode === "BLUETOOTH_OFF") {
      return tx(
        "Activa el Bluetooth de tu teléfono para detectar tu sensor de pulso.",
        "Turn on your phone's Bluetooth to detect your heart rate sensor."
      );
    }
    if (status.errorCode === "PERMISSION_DENIED") {
      return tx(
        "Autoriza el permiso de dispositivos cercanos (Bluetooth) para vincular tu sensor.",
        "Allow Nearby Devices (Bluetooth) permission to pair your sensor."
      );
    }
    if (status.errorCode === "BLE_UNSUPPORTED") {
      return tx(
        "Este navegador no admite Bluetooth directo. Usa la aplicación instalada en Android o un navegador compatible con Bluetooth Web.",
        "This browser does not support direct Bluetooth. Use the installed Android app or a Web Bluetooth browser."
      );
    }
    return tx(
      "No fue posible conectar con el sensor. Verifica que esté encendido y transmitiendo pulso.",
      "Could not connect to the sensor. Make sure it is powered on and broadcasting heart rate."
    );
  })();

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as any)}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100vw-24px)] max-w-[388px] max-h-[92dvh] p-0 bg-transparent border-0 text-white overflow-y-auto overscroll-contain outline-none open:block"
    >
      <div
        dir="ltr"
        className="w-full bg-[#06080C] border border-white/[0.11] rounded-[26px] p-4 flex flex-col gap-3.5 relative select-none"
      >
        {/* Top 101010 tricolor line */}
        <div
          className="absolute top-0 left-12 right-12 h-[2px]"
          style={{
            background:
              "linear-gradient(90deg, transparent, #00A8F3 25%, #FF1E1E 50%, #FFE500 75%, transparent)"
          }}
        />

        {/* Single-Line Brand Header */}
        <div className="w-full flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/images/brand_logo_header.png"
              srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
              alt="ARCHERY 101010"
              className="h-[11.5px] w-auto object-contain shrink-0 select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]"
              draggable={false}
            />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-[8.5px] font-extrabold tracking-[0.08em] uppercase leading-none shrink-0 tabular-nums ${
                isConnected
                  ? "bg-[#051810] border-[#00C853]/50 text-white"
                  : isScanning || isConnecting
                  ? "bg-[#05121E] border-[#00BFFF]/50 text-white"
                  : "bg-[#0B0E14] border-white/[0.12] text-white"
              }`}
            >
              <span
                className={`w-[5px] h-[5px] rounded-full shrink-0 ${
                  isConnected
                    ? "bg-[#00C853]"
                    : isScanning || isConnecting
                    ? "bg-[#00BFFF]"
                    : "bg-[#6E7785]"
                }`}
              />
              <span>{statusBadgeText}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={handleCloseClick}
            aria-label={tx("Cerrar sensor de pulso", "Close heart rate sensor")}
            className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.12] text-white flex items-center justify-center hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {/* Title Block */}
        <div className="flex flex-col gap-0.5">
          <h2
            id={titleId}
            className="text-[16.5px] font-extrabold text-white tracking-tight leading-snug"
          >
            {t("bleHrTitle")}
          </h2>
          <p className="text-[12px] font-medium text-white leading-snug">
            {t("bleHrSubtitle")}
          </p>
        </div>

        {/* Matte Titanium Live Heart Rate Telemetry Chassis */}
        <div className="bg-[#0B0E15] border border-white/[0.10] rounded-2xl p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-white">
              {t("cardHeartRate")}
            </span>
            <div className="flex items-center gap-1.5 min-w-0">
              {status.deviceName && (
                <span className="text-[10.5px] font-bold text-[#00BFFF] truncate max-w-[165px] tabular-nums">
                  {status.deviceName}
                </span>
              )}
              {typeof status.batteryPct === "number" && (
                <span className="text-[9.5px] font-extrabold text-white bg-[#121621] border border-white/[0.12] px-1.5 py-0.5 rounded-md tabular-nums shrink-0">
                  {status.batteryPct}%
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 items-end pt-0.5">
            <div className="col-span-1 flex items-baseline gap-1">
              <span className="font-sans text-[34px] font-extrabold leading-none text-white tabular-nums">
                {isConnected && status.currentBpm >= 30 ? status.currentBpm : "—"}
              </span>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#FF1E1E]">
                BPM
              </span>
            </div>

            <div className="bg-[#06080C] border border-white/[0.08] rounded-xl px-2.5 py-1.5 text-center">
              <span className="text-[8.5px] font-extrabold tracking-[0.1em] uppercase text-white block">
                {tx("PROMEDIO", "AVERAGE")}
              </span>
              <span className="text-[14px] font-extrabold text-white tabular-nums leading-tight block mt-0.5">
                {status.avgHeartRateBpm >= 30 ? `${status.avgHeartRateBpm} BPM` : "—"}
              </span>
            </div>

            <div className="bg-[#06080C] border border-white/[0.08] rounded-xl px-2.5 py-1.5 text-center">
              <span className="text-[8.5px] font-extrabold tracking-[0.1em] uppercase text-white block">
                {tx("MÁXIMO", "PEAK")}
              </span>
              <span className="text-[14px] font-extrabold text-[#FFE500] tabular-nums leading-tight block mt-0.5">
                {status.maxHeartRateBpm >= 30 ? `${status.maxHeartRateBpm} BPM` : "—"}
              </span>
            </div>
          </div>

          {isConnected && status.contactDetected === false && (
            <div className="text-[11px] font-semibold text-[#FFE500] bg-[#121107] border border-[#FFE500]/35 rounded-xl px-2.5 py-1.5">
              {tx(
                "Ajusta el sensor sobre la piel para estabilizar la lectura.",
                "Adjust the sensor against your skin to stabilize the reading."
              )}
            </div>
          )}
        </div>

        {/* Architectural 01 · 02 Instructions (Zero AI Icons, Pure Typography + Brand Bars) */}
        {!isConnected && (
          <div className="bg-[#090C12] border border-white/[0.08] rounded-2xl p-3.5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                <span className="w-[3px] h-[26px] rounded-full bg-[#00BFFF]" />
                <span className="font-sans text-[15px] font-black text-white tabular-nums">
                  01
                </span>
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white">
                  {tx("ACTIVA TRANSMITIR PULSO", "ENABLE HEART RATE BROADCAST")}
                </span>
                <span className="text-[11.5px] font-normal text-white leading-snug">
                  {tx(
                    "En los ajustes de tu pulsera deportiva o banda, activa la opción de transmitir frecuencia cardíaca por Bluetooth.",
                    "In your fitness band or strap settings, turn on Bluetooth heart rate broadcasting."
                  )}
                </span>
              </div>
            </div>

            <div className="h-[1px] bg-white/[0.06]" />

            <div className="flex items-start gap-3">
              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                <span className="w-[3px] h-[26px] rounded-full bg-[#FFE500]" />
                <span className="font-sans text-[15px] font-black text-white tabular-nums">
                  02
                </span>
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white">
                  {tx("VINCULA EN UN TOQUE", "PAIR IN ONE TAP")}
                </span>
                <span className="text-[11.5px] font-normal text-white leading-snug">
                  {tx(
                    "Elige tu sensor abajo. Se conectará automáticamente en tus próximas sesiones sin aplicaciones adicionales.",
                    "Select your sensor below. It will auto-connect in future sessions with no extra apps."
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Actionable Status / Error Notice */}
        {errorBannerMessage && (
          <div
            role="alert"
            className="bg-[#141106] border border-[#FFE500]/45 rounded-2xl px-3 py-2.5 text-[11.5px] font-semibold text-white leading-snug"
          >
            {errorBannerMessage}
          </div>
        )}

        {/* Native Android Discovered Sensors List */}
        {status.transport === "native_android" && !isConnected && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-white">
                {tx("SENSORES DETECTADOS", "DETECTED SENSORS")}
              </span>
              <span className="text-[10px] font-bold text-[#00BFFF] tabular-nums">
                {isScanning
                  ? t("bleHrScanning")
                  : `${status.discoveredDevices.length} ${tx("disp.", "dev.")}`}
              </span>
            </div>

            {status.discoveredDevices.length === 0 ? (
              <div className="bg-[#090C12] border border-white/[0.08] rounded-xl px-3 py-3 text-center text-[11.5px] text-white">
                {isScanning
                  ? tx(
                      "Buscando pulseras y bandas cercanas...",
                      "Scanning for nearby bands and straps..."
                    )
                  : tx(
                      "No se detectaron sensores aún. Toca Buscar Sensor para actualizar.",
                      "No sensors detected yet. Tap Scan Sensor to refresh."
                    )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[176px] overflow-y-auto pr-0.5">
                {status.discoveredDevices.map((dev) => {
                  const isThisConnecting = isConnecting && status.deviceId === dev.id;
                  return (
                    <div
                      key={dev.id}
                      className="bg-[#0B0E15] border border-white/[0.10] rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-[12.5px] font-extrabold text-white truncate">
                          {dev.name}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {dev.hasHrService ? (
                            <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#00C853]">
                              {tx("● PULSO ACTIVO", "● HR READY")}
                            </span>
                          ) : dev.isBondedOrConnected ? (
                            <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#00BFFF]">
                              {tx("EMPAREJADO EN TELÉFONO", "PAIRED ON PHONE")}
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-white">
                              BLUETOOTH LE
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isThisConnecting}
                        onClick={() => connectBleHeartRateDevice(dev.id, dev.name)}
                        className="min-h-[34px] px-3 rounded-lg bg-[#00BFFF] hover:brightness-105 text-black font-black text-[11px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-60"
                      >
                        {isThisConnecting ? tx("Conectando...", "Connecting...") : t("bleHrConnect")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center gap-2 pt-0.5">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={() => disconnectBleHeartRateDevice(true)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#180709] border border-[#FF1E1E]/60 text-white font-extrabold text-[12px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
              >
                {t("bleHrDisconnect")}
              </button>
              <button
                type="button"
                onClick={handleCloseClick}
                className="flex-1 min-h-[44px] rounded-xl bg-[#00BFFF] hover:brightness-105 text-black font-black text-[12.5px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
              >
                {tx("Listo", "Done")}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isConnecting}
              onClick={() => startBleHeartRateScanOrRequest()}
              className="w-full min-h-[46px] rounded-xl bg-[#00BFFF] hover:brightness-105 text-black font-black text-[13px] uppercase tracking-[0.08em] cursor-pointer active:scale-[0.99] transition disabled:opacity-60"
            >
              {isScanning
                ? t("bleHrScanning")
                : status.transport === "native_android"
                ? tx("Buscar Sensor Bluetooth", "Scan Bluetooth Sensor")
                : tx("Vincular Sensor Bluetooth", "Pair Bluetooth Sensor")}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
