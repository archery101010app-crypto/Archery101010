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
  const isExplicitConnecting = status.state === "connecting";
  const isReconnecting = status.state === "reconnecting";
  const isConnecting = isExplicitConnecting || isReconnecting;
  const isOutdatedAndroidShell =
    !status.supported &&
    typeof window !== "undefined" &&
    Boolean((window as any).ArcheryNativeAuth || (window as any).Capacitor?.isNativePlatform?.());

  const statusBadgeText = !status.supported
    ? tx("ACTUALIZAR APP", "UPDATE APP")
    : isConnected
    ? tx("EN VIVO", "LIVE")
    : isConnecting
    ? tx("CONECTANDO", "CONNECTING")
    : isScanning
    ? t("bleHrScanning")
    : tx("EN ESPERA", "STANDBY");

  const errorBannerMessage = (() => {
    if (isOutdatedAndroidShell) {
      return tx(
        "Instala la actualización más reciente del APK de Android para activar la conexión Bluetooth directa con tu sensor de pulso.",
        "Install the latest Android APK update to enable direct Bluetooth connection with your heart rate sensor."
      );
    }
    if (!status.supported || status.errorCode === "BLE_UNSUPPORTED") {
      return tx(
        "Este navegador no admite Bluetooth directo. Usa la aplicación instalada en Android o un navegador compatible con Bluetooth Web.",
        "This browser does not support direct Bluetooth. Use the installed Android app or a Web Bluetooth browser."
      );
    }
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
    if (status.errorCode === "LOCATION_SERVICES_OFF") {
      return tx(
        "En Android 10/11 activa la Ubicación del teléfono para que el sistema permita escanear sensores Bluetooth cercanos.",
        "On Android 10/11 turn on system Location so Android permits scanning nearby Bluetooth sensors."
      );
    }
    if (status.errorCode === "PERMISSION_DENIED") {
      return tx(
        "Autoriza el permiso de dispositivos cercanos / ubicación Bluetooth para vincular tu sensor.",
        "Allow Nearby Devices / Bluetooth permission to pair your sensor."
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
      className="m-auto w-[calc(100vw-14px)] max-w-[420px] max-h-[94dvh] p-0 bg-transparent border-0 text-white font-sans overflow-y-auto overscroll-contain outline-none open:block"
    >
      <div
        dir="ltr"
        className="w-full bg-[#04060A] border border-white/[0.15] rounded-[28px] p-5 flex flex-col gap-4 relative select-none font-sans"
      >
        {/* Top 101010 tricolor line */}
        <div
          className="absolute top-0 left-12 right-12 h-[2.5px]"
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
              className="h-[12.5px] min-[385px]:h-[13.5px] w-auto object-contain shrink-0 select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]"
              draggable={false}
            />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full h-[25px] px-2.5 border text-[10px] min-[385px]:text-[10.8px] font-bold tracking-[0.04em] uppercase leading-none shrink-0 tabular-nums whitespace-nowrap ${
                isConnected
                  ? "bg-[#051810] border-[#00C853]/65 text-white"
                  : isScanning || isConnecting
                  ? "bg-[#05121E] border-[#00BFFF]/65 text-white"
                  : "bg-[#0B0E15] border-white/[0.16] text-white"
              }`}
            >
              <span
                className={`w-[6px] h-[6px] rounded-full shrink-0 ${
                  isConnected
                    ? "bg-[#00C853]"
                    : isScanning || isConnecting
                    ? "bg-[#00BFFF]"
                    : "bg-[#8E96A4]"
                }`}
              />
              <span>{statusBadgeText}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={handleCloseClick}
            aria-label={tx("Cerrar sensor de pulso", "Close heart rate sensor")}
            className="min-w-[40px] min-h-[40px] w-10 h-10 rounded-full bg-[#10131B] border border-white/[0.16] text-white flex items-center justify-center hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Title Block (High-Visibility Outdoor Scale) */}
        <div className="flex flex-col gap-1">
          <h2
            id={titleId}
            className="text-[22px] font-bold text-white tracking-normal leading-tight"
          >
            {t("bleHrTitle")}
          </h2>
          <p className="text-[15.5px] font-normal text-white leading-snug">
            {t("bleHrSubtitle")}
          </p>
        </div>

        {/* Matte Titanium Live Heart Rate Telemetry Chassis */}
        <div className="bg-[#0B0E15] border border-white/[0.14] rounded-[22px] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.5px] font-extrabold tracking-[0.07em] uppercase text-white">
              {t("cardHeartRate")}
            </span>
            <div className="flex items-center gap-2 min-w-0">
              {status.deviceName && (
                <span className="text-[13px] font-bold text-[#00BFFF] truncate max-w-[175px] tabular-nums">
                  {status.deviceName}
                </span>
              )}
              {typeof status.batteryPct === "number" && (
                <span className="text-[12px] font-bold text-white bg-[#121621] border border-white/[0.16] px-2 py-0.5 rounded-lg tabular-nums shrink-0">
                  {status.batteryPct}%
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[1.05fr_1fr_1fr] gap-2.5 items-center pt-0.5">
            <div className="flex items-baseline gap-1.5">
              <span className="font-sans text-[42px] font-extrabold leading-none text-white tabular-nums">
                {isConnected && status.currentBpm >= 30 ? status.currentBpm : "—"}
              </span>
              <span className="text-[14px] font-extrabold uppercase tracking-wider text-[#FF1E1E]">
                BPM
              </span>
            </div>

            <div className="bg-[#05070B] border border-white/[0.13] rounded-2xl px-2.5 py-2.5 text-center flex flex-col justify-center gap-0.5 min-h-[60px]">
              <span className="text-[11px] font-bold tracking-[0.06em] uppercase text-white block">
                {tx("PROMEDIO", "AVERAGE")}
              </span>
              <span className="text-[17.5px] font-extrabold text-white tabular-nums leading-tight block">
                {status.avgHeartRateBpm >= 30 ? status.avgHeartRateBpm : "—"}
              </span>
            </div>

            <div className="bg-[#05070B] border border-white/[0.13] rounded-2xl px-2.5 py-2.5 text-center flex flex-col justify-center gap-0.5 min-h-[60px]">
              <span className="text-[11px] font-bold tracking-[0.06em] uppercase text-white block">
                {tx("MÁXIMO", "PEAK")}
              </span>
              <span className="text-[17.5px] font-extrabold text-[#FFE500] tabular-nums leading-tight block">
                {status.maxHeartRateBpm >= 30 ? status.maxHeartRateBpm : "—"}
              </span>
            </div>
          </div>

          {isConnected && status.contactDetected === false && (
            <div className="text-[13.5px] font-semibold text-[#FFE500] bg-[#141206] border border-[#FFE500]/50 rounded-xl px-3.5 py-2.5 leading-snug">
              {tx(
                "Ajusta el sensor sobre la piel para estabilizar la lectura.",
                "Adjust the sensor against your skin to stabilize the reading."
              )}
            </div>
          )}
        </div>

        {/* Architectural 01 · 02 Instructions (High-Contrast Sunlight Scale) */}
        {!isConnected && (
          <div className="bg-[#090C12] border border-white/[0.13] rounded-[22px] p-4 flex flex-col gap-3.5">
            <div className="flex items-center gap-3">
              <span className="w-[3.5px] h-[40px] rounded-full bg-[#00BFFF] shrink-0" />
              <span className="font-sans text-[20px] font-extrabold text-[#00BFFF] tabular-nums shrink-0">
                01
              </span>
              <span className="w-[1px] h-[34px] bg-white/[0.10] shrink-0" />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[14.5px] font-bold uppercase tracking-[0.03em] text-white leading-tight">
                  {tx("Activa transmitir pulso", "Enable heart rate broadcast")}
                </span>
                <span className="text-[14px] font-normal text-white leading-snug">
                  {tx(
                    "En los ajustes de tu pulsera deportiva o banda, activa la opción de transmitir frecuencia cardíaca por Bluetooth.",
                    "In your fitness band or strap settings, turn on Bluetooth heart rate broadcasting."
                  )}
                </span>
              </div>
            </div>

            <div className="h-[1px] bg-white/[0.09]" />

            <div className="flex items-center gap-3">
              <span className="w-[3.5px] h-[40px] rounded-full bg-[#FFE500] shrink-0" />
              <span className="font-sans text-[20px] font-extrabold text-[#FFE500] tabular-nums shrink-0">
                02
              </span>
              <span className="w-[1px] h-[34px] bg-white/[0.10] shrink-0" />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[14.5px] font-bold uppercase tracking-[0.03em] text-white leading-tight">
                  {tx("Vincula en un toque", "Pair in one tap")}
                </span>
                <span className="text-[14px] font-normal text-white leading-snug">
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
            className="bg-[#151205] border border-[#FFE500]/65 rounded-2xl px-4 py-3 text-[14px] font-medium text-white leading-snug"
          >
            {errorBannerMessage}
          </div>
        )}

        {/* Native Android Discovered Sensors List */}
        {status.transport === "native_android" && !isConnected && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[13px] font-bold uppercase tracking-[0.06em] text-white">
                {tx("SENSORES DETECTADOS", "DETECTED SENSORS")}
              </span>
              <span className="text-[13px] font-bold text-[#00BFFF] tabular-nums">
                {isScanning
                  ? t("bleHrScanning")
                  : `${status.discoveredDevices.length} ${tx("disp.", "dev.")}`}
              </span>
            </div>

            {status.discoveredDevices.length === 0 ? (
              <div className="bg-[#090C12] border border-white/[0.12] rounded-2xl px-3.5 py-3.5 text-center text-[14px] font-normal text-white leading-snug">
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
              <div className="flex flex-col gap-2 max-h-[196px] overflow-y-auto pr-0.5">
                {status.discoveredDevices.map((dev) => {
                  const isThisConnecting = isConnecting && status.deviceId === dev.id;
                  return (
                    <div
                      key={dev.id}
                      className="bg-[#0B0E15] border border-white/[0.14] rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2.5"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-[15.5px] font-bold text-white truncate">
                          {dev.name}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {dev.hasHrService ? (
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-[#00C853]">
                              {tx("● PULSO ACTIVO", "● HR READY")}
                            </span>
                          ) : dev.isBondedOrConnected ? (
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-[#00BFFF]">
                              {tx("EMPAREJADO EN TELÉFONO", "PAIRED ON PHONE")}
                            </span>
                          ) : (
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-white">
                              BLUETOOTH LE
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isThisConnecting}
                        onClick={() => connectBleHeartRateDevice(dev.id, dev.name)}
                        className="min-h-[40px] px-3.5 rounded-xl bg-[#00BFFF] hover:brightness-105 text-black font-extrabold text-[13px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-60"
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
        <div className="flex items-center gap-2.5 pt-0.5">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={() => disconnectBleHeartRateDevice(true)}
                className="flex-1 min-h-[52px] rounded-2xl bg-[#180709] border border-[#FF1E1E]/65 text-white font-bold text-[14.5px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
              >
                {t("bleHrDisconnect")}
              </button>
              <button
                type="button"
                onClick={handleCloseClick}
                className="flex-1 min-h-[52px] rounded-2xl bg-[#00BFFF] hover:brightness-105 text-black font-extrabold text-[15px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
              >
                {tx("Listo", "Done")}
              </button>
            </>
          ) : isOutdatedAndroidShell ? (
            <a
              href="https://archery101010-c0bb4.web.app/download-apk"
              className="w-full min-h-[54px] rounded-2xl bg-[#FFE500] hover:brightness-105 text-black font-extrabold text-[15.5px] uppercase tracking-[0.05em] flex items-center justify-center cursor-pointer active:scale-[0.99] transition"
            >
              {tx("Actualizar APK Android", "Update Android APK")}
            </a>
          ) : (
            <div className="w-full flex items-center gap-2.5">
              {Boolean(status.deviceId) && (isReconnecting || isExplicitConnecting) && (
                <button
                  type="button"
                  onClick={() => disconnectBleHeartRateDevice(true)}
                  className="min-h-[54px] px-4 rounded-2xl bg-[#180709] border border-[#FF1E1E]/65 text-white font-bold text-[13.5px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-[0.99] transition"
                >
                  {tx("Olvidar", "Forget")}
                </button>
              )}
              <button
                type="button"
                disabled={isExplicitConnecting}
                onClick={() => startBleHeartRateScanOrRequest()}
                className="flex-1 min-h-[54px] rounded-2xl bg-[#00BFFF] hover:brightness-105 text-black font-extrabold text-[15.5px] uppercase tracking-[0.05em] cursor-pointer active:scale-[0.99] transition disabled:opacity-60"
              >
                {isScanning
                  ? t("bleHrScanning")
                  : status.transport === "native_android"
                  ? tx("Buscar Sensor Bluetooth", "Scan Bluetooth Sensor")
                  : tx("Vincular Sensor Bluetooth", "Pair Bluetooth Sensor")}
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
