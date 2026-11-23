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
  isLikelyCompanionSmartwatch,
  startBleHeartRateScanOrRequest,
  stopBleHeartRateScan,
  subscribeBleHeartRate
} from "@/lib/scoring/bleHeartRateService";

interface BleHeartRateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BleHeartRateModal({ isOpen, onClose }: BleHeartRateModalProps) {
  const { language, t, tx } = useLanguage();
  const isEs = language === "es";
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  const [status, setStatus] = useState<BleHeartRateStatus>(() => getBleHeartRateStatus());
  const [tappedUnsupported, setTappedUnsupported] = useState(false);

  useEffect(() => {
    return subscribeBleHeartRate((next) => {
      setStatus(next);
      if (next.supported) {
        setTappedUnsupported(false);
      }
    });
  }, []);

  // Open/close native <dialog> via showModal() + light-dismiss fallback + mobile back stack
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      dialog.returnValue = "";
      setTappedUnsupported(false);
      stopBleHeartRateScan();
      onCloseRef.current();
    };

    dialog.addEventListener("close", handleNativeClose);

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
      setTappedUnsupported(false);
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {}
      }
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
    setTappedUnsupported(false);
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

  const statusBadgeText = isConnected
    ? tx("EN VIVO", "LIVE")
    : isConnecting
    ? tx("CONECTANDO", "CONNECTING")
    : isScanning
    ? t("bleHrScanning")
    : tx("EN ESPERA", "STANDBY");

  const errorBannerMessage = (() => {
    if (!status.supported) {
      if (!tappedUnsupported) return "";
      return tx(
        "Activa el Bluetooth de tu dispositivo",
        "Turn on Bluetooth on your device"
      );
    }
    if (!status.errorCode || status.errorCode === "BLE_UNSUPPORTED") return "";
    if (status.errorCode === "PERMISSION_DENIED") {
      return tx(
        "Permite el acceso a Bluetooth en Ajustes",
        "Allow Bluetooth access in Settings"
      );
    }
    if (status.errorCode === "LOCATION_SERVICES_OFF") {
      return tx(
        "Activa la Ubicación para detectar dispositivos",
        "Turn on Location to detect devices"
      );
    }
    if (status.errorCode === "HR_BROADCAST_NOT_ENABLED") {
      return tx(
        "Este dispositivo tiene apagado Transmitir pulso. Actívalo en su app o ajustes, o abre ARCHERY 101010 en tu reloj.",
        "Heart rate broadcast is turned off on this device. Enable it in its app or settings, or open ARCHERY 101010 on your watch."
      );
    }
    if (status.errorCode === "WEAR_APP_REQUIRED") {
      return tx(
        "Abre ARCHERY 101010 en tu reloj: el pulso llegará solo.",
        "Open ARCHERY 101010 on your watch: pulse will arrive automatically."
      );
    }
    if (status.errorCode === "WEAR_HR_PERMISSION_DENIED") {
      return tx(
        "Permite el sensor de pulso en la app del reloj.",
        "Allow the heart rate sensor in the watch app."
      );
    }
    if (status.errorCode === "WEAR_HR_NO_SENSOR") {
      return tx(
        "Tu reloj no tiene sensor de pulso disponible.",
        "Your watch has no heart rate sensor available."
      );
    }
    if (status.errorCode === "CONNECT_FAILED") {
      return tx(
        "Acerca tu dispositivo y vuelve a intentar",
        "Move your device closer and try again"
      );
    }
    return tx(
      "Activa el Bluetooth de tu dispositivo",
      "Turn on Bluetooth on your device"
    );
  })();

  const handleScanOrPairClick = () => {
    if (!status.supported) {
      setTappedUnsupported(true);
      return;
    }
    startBleHeartRateScanOrRequest();
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as any)}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100vw-14px)] max-w-[420px] max-h-[94dvh] p-0 bg-transparent border-0 text-white font-sans overflow-y-auto overscroll-contain outline-none open:block"
    >
      <div
        dir={isEs ? "ltr" : undefined}
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
          <div dir="ltr" className="flex items-center gap-2 min-w-0">
            <img
              src="/images/brand_logo_header.png"
              srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
              alt="ARCHERY 101010"
              className={`${
                isEs ? "h-[12.5px] min-[385px]:h-[13.5px]" : "h-[11px] min-[385px]:h-[12.5px]"
              } w-auto object-contain shrink-0 select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]`}
              draggable={false}
            />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full h-[25px] px-2.5 border text-[10px] min-[385px]:text-[10.8px] font-bold tracking-[0.04em] uppercase leading-none ${
                isEs ? "shrink-0" : "min-w-0 overflow-hidden"
              } tabular-nums whitespace-nowrap ${
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
              <span className={isEs ? undefined : "max-w-[128px] truncate"}>{statusBadgeText}</span>
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
        <h2
          id={titleId}
          className="text-[24px] font-bold text-white tracking-normal leading-tight"
        >
          {t("bleHrTitle")}
        </h2>

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

          <div
            className={`grid ${
              isEs ? "grid-cols-[1.05fr_1fr_1fr]" : "grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]"
            } gap-2.5 items-center pt-0.5`}
          >
            <div dir="ltr" className="flex items-baseline gap-1.5">
              <span
                className={`font-sans ${
                  isEs ? "text-[44px]" : "text-[38px] min-[385px]:text-[44px]"
                } font-extrabold leading-none text-white tabular-nums`}
              >
                {isConnected && status.currentBpm >= 30 ? status.currentBpm : "—"}
              </span>
              <span className="text-[14px] font-extrabold uppercase tracking-wider text-[#FF1E1E]">
                BPM
              </span>
            </div>

            <div
              className={`bg-[#05070B] border border-white/[0.13] rounded-2xl px-2.5 py-2.5 text-center flex flex-col justify-center gap-0.5 min-h-[62px]${
                isEs ? "" : " min-w-0"
              }`}
            >
              <span
                className={
                  isEs
                    ? "text-[11.5px] font-bold tracking-[0.06em] uppercase text-white block"
                    : "truncate w-full text-center text-[10.5px] min-[385px]:text-[11.5px] font-bold tracking-[0.06em] uppercase text-white block"
                }
              >
                {isEs ? tx("PROMEDIO", "AVERAGE") : t("cardAverage")}
              </span>
              <span className="text-[18px] font-extrabold text-white tabular-nums leading-tight block">
                {status.avgHeartRateBpm >= 30 ? status.avgHeartRateBpm : "—"}
              </span>
            </div>

            <div
              className={`bg-[#05070B] border border-white/[0.13] rounded-2xl px-2.5 py-2.5 text-center flex flex-col justify-center gap-0.5 min-h-[62px]${
                isEs ? "" : " min-w-0"
              }`}
            >
              <span
                className={
                  isEs
                    ? "text-[11.5px] font-bold tracking-[0.06em] uppercase text-white block"
                    : "truncate w-full text-center text-[10.5px] min-[385px]:text-[11.5px] font-bold tracking-[0.06em] uppercase text-white block"
                }
              >
                {tx("MÁXIMO", "PEAK")}
              </span>
              <span className="text-[18px] font-extrabold text-[#FFE500] tabular-nums leading-tight block">
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

        {/* Actionable In-App Status Notice */}
        {errorBannerMessage && (
          <div
            role="alert"
            className="bg-[#0B1018] border border-white/[0.16] rounded-2xl px-4 py-3.5 text-[16px] font-semibold text-white text-center leading-snug"
          >
            {errorBannerMessage}
          </div>
        )}

        {/* Native Android Discovered Sensors List */}
        {status.transport === "native_android" && !isConnected && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[13.5px] font-bold uppercase tracking-[0.06em] text-white">
                {tx("DISPOSITIVOS CERCANOS", "NEARBY DEVICES")}
              </span>
              <span className="text-[13.5px] font-bold text-[#00BFFF] tabular-nums">
                {isScanning
                  ? t("bleHrScanning")
                  : `${status.discoveredDevices.length} ${tx("disp.", "dev.")}`}
              </span>
            </div>

            {status.discoveredDevices.length === 0 ? (
              <div className="bg-[#090C12] border border-white/[0.12] rounded-2xl px-3.5 py-3.5 text-center text-[15px] font-medium text-white leading-snug">
                {isScanning
                  ? tx(
                      "Buscando dispositivos cercanos...",
                      "Scanning for nearby devices..."
                    )
                  : tx(
                      "Toca Buscar dispositivo para conectar.",
                      "Tap Scan device to connect."
                    )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[210px] overflow-y-auto pr-0.5">
                {status.discoveredDevices.map((dev) => {
                  const isThisConnecting = isConnecting && status.deviceId === dev.id;
                  const isCompanionWatch = isLikelyCompanionSmartwatch(dev);
                  return (
                    <div
                      key={dev.id}
                      className="bg-[#0B0E15] border border-white/[0.14] rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2.5"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-[16px] font-bold text-white truncate">
                          {dev.name}
                        </span>
                        <div className={`flex items-center gap-1.5 mt-0.5${isEs ? "" : " min-w-0"}`}>
                          {dev.hasHrService ? (
                            <span className="text-[12px] font-bold uppercase tracking-wider text-[#00C853]">
                              {tx("● PULSO ACTIVO", "● HR READY")}
                            </span>
                          ) : isCompanionWatch ? (
                            <span className={`text-[12px] font-bold uppercase tracking-wider text-[#FFE500]${isEs ? "" : " truncate"}`}>
                              {tx("VÍA APP DEL RELOJ", "VIA WATCH APP")}
                            </span>
                          ) : dev.isBondedOrConnected ? (
                            <span className={`text-[12px] font-bold uppercase tracking-wider text-[#00BFFF]${isEs ? "" : " truncate"}`}>
                              {tx("EMPAREJADO EN TELÉFONO", "PAIRED ON PHONE")}
                            </span>
                          ) : (
                            <span className="text-[12px] font-bold uppercase tracking-wider text-white">
                              BLUETOOTH LE
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isThisConnecting}
                        onClick={() => connectBleHeartRateDevice(dev.id, dev.name)}
                        className={`min-h-[42px] px-4 rounded-xl bg-[#00BFFF] hover:brightness-105 text-black font-bold text-[14px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-60${
                          isEs ? "" : " max-w-[132px] truncate"
                        }`}
                      >
                        {isThisConnecting
                          ? tx("Conectando...", "Connecting...")
                          : isCompanionWatch
                          ? tx("Usar reloj", "Use watch")
                          : t("bleHrConnect")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[12.5px] font-medium text-[#94A3B8] leading-snug px-0.5">
              {tx(
                "Bandas y cintas: activa Transmitir pulso en su app o ajustes. Relojes: abre ARCHERY 101010 en el reloj o vincula su código de 6 dígitos.",
                "Bands & straps: enable Broadcast heart rate in its app or settings. Watches: open ARCHERY 101010 on the watch or link its 6-digit code."
              )}
            </p>
          </div>
        )}

        {/* Footer Actions — 100% In-App */}
        <div className="flex items-center gap-2.5 pt-0.5">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={() => disconnectBleHeartRateDevice(true)}
                className="flex-1 min-h-[54px] rounded-2xl bg-[#180709] border border-[#FF1E1E]/65 text-white font-bold text-[15px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
              >
                {t("bleHrDisconnect")}
              </button>
              <button
                type="button"
                onClick={handleCloseClick}
                className="flex-1 min-h-[54px] rounded-2xl bg-[#00BFFF] hover:brightness-105 text-black font-bold text-[15.5px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
              >
                {tx("Listo", "Done")}
              </button>
            </>
          ) : (
            <div className="w-full flex items-center gap-2.5">
              {Boolean(status.deviceId) && (isReconnecting || isExplicitConnecting) && (
                <button
                  type="button"
                  onClick={() => disconnectBleHeartRateDevice(true)}
                  className="min-h-[54px] px-4 rounded-2xl bg-[#180709] border border-[#FF1E1E]/65 text-white font-bold text-[14px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-[0.99] transition"
                >
                  {tx("Olvidar", "Forget")}
                </button>
              )}
              <button
                type="button"
                disabled={isExplicitConnecting || isScanning}
                onClick={handleScanOrPairClick}
                className="flex-1 min-h-[54px] rounded-2xl bg-[#00BFFF] hover:brightness-105 text-black font-bold text-[16.5px] uppercase tracking-[0.04em] cursor-pointer active:scale-[0.99] transition disabled:opacity-60"
              >
                {isScanning
                  ? t("bleHrScanning")
                  : tx("Buscar dispositivo", "Scan device")}
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
