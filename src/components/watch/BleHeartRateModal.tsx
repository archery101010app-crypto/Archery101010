"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Watch, X } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import {
  CloudWatchPairingStatus,
  WatchConnectionStatus,
  ensurePhoneWatchPairingReady,
  getOrCreatePhoneWatchPairingCode,
  refreshPhoneWatchPairingWindow,
  pingNativeWatch,
  subscribeCloudWatchPairingStatus,
  subscribeWatchConnectionStatus
} from "@/lib/scoring/biometricsEngine";
import { auth } from "@/lib/firebase";
import {
  BleHeartRateStatus,
  connectBleHeartRateDevice,
  disconnectBleHeartRateDevice,
  getBleHeartRateStatus,
  isLikelyCompanionSmartwatch,
  requestWatchAppHeartRate,
  startBleHeartRateScanOrRequest,
  stopBleHeartRateScan,
  subscribeBleHeartRate
} from "@/lib/scoring/bleHeartRateService";

interface BleHeartRateModalProps {
  isOpen: boolean;
  userUid?: string;
  onClose: () => void;
}

export default function BleHeartRateModal({ isOpen, userUid, onClose }: BleHeartRateModalProps) {
  const { language, t, tx } = useLanguage();
  const isEs = language === "es";
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  const syncWatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const [evalNowMs, setEvalNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const [status, setStatus] = useState<BleHeartRateStatus>(() => getBleHeartRateStatus());
  const [tappedUnsupported, setTappedUnsupported] = useState(false);
  const [isSyncingWatch, setIsSyncingWatch] = useState(false);
  const [watchConnStatus, setWatchConnStatus] = useState<WatchConnectionStatus>({
    isNativeAndroid: false,
    bridgeReady: false,
    connectedNodesCount: 0,
    connectedNodes: [],
    lastMessageAt: 0,
    lastPongAt: 0,
    hasCachedState: false
  });
  const [cloudStatus, setCloudStatus] = useState<CloudWatchPairingStatus>({
    pairingCode: "",
    cloudConnected: false,
    watchLinked: false,
    watchSource: null,
    lastCloudSyncAt: 0,
    lastWatchSeenAt: 0
  });

  useEffect(() => {
    const unsubBle = subscribeBleHeartRate((next) => {
      setStatus(next);
      if (next.supported) {
        setTappedUnsupported(false);
      }
      if (next.state === "connected" && next.source === "wear_os" && next.currentBpm >= 30) {
        setIsSyncingWatch(false);
      }
    });
    const unsubWatch = subscribeWatchConnectionStatus((next) => {
      setWatchConnStatus(next);
      setEvalNowMs(Date.now());
    });
    const unsubCloud = subscribeCloudWatchPairingStatus((next) => {
      setCloudStatus(next);
      setEvalNowMs(Date.now());
    });
    return () => {
      unsubBle();
      unsubWatch();
      unsubCloud();
      if (syncWatchTimerRef.current) {
        clearTimeout(syncWatchTimerRef.current);
        syncWatchTimerRef.current = null;
      }
    };
  }, []);

  // Open/close native <dialog> via showModal() + light-dismiss fallback + mobile back stack
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      dialog.returnValue = "";
      setTappedUnsupported(false);
      setIsSyncingWatch(false);
      stopBleHeartRateScan();
      onCloseRef.current();
    };

    dialog.addEventListener("close", handleNativeClose);

    let removeLightDismissFallback: (() => void) | null = null;
    if (
      typeof HTMLDialogElement !== "undefined" &&
      !("closedBy" in HTMLDialogElement.prototype)
    ) {
      const isPointerOutside = (event: PointerEvent) => {
        const rect = dialog.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      const onPointerDown = (event: PointerEvent) => {
        pressedOutside = isPointerOutside(event);
      };
      const onPointerUp = (event: PointerEvent) => {
        if (pressedOutside && isPointerOutside(event) && dialog.open) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      removeLightDismissFallback = () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
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
      const effectiveUid = userUid || auth.currentUser?.uid;
      ensurePhoneWatchPairingReady(effectiveUid);
      if (effectiveUid) {
        refreshPhoneWatchPairingWindow(effectiveUid, true).catch(() => {});
      }
      requestWatchAppHeartRate();
      pingNativeWatch();
      const pollWatchTimer = setInterval(() => {
        setEvalNowMs(Date.now());
        ensurePhoneWatchPairingReady(userUid || auth.currentUser?.uid);
        requestWatchAppHeartRate({ unmute: false });
        pingNativeWatch();
      }, 3000);
      const refreshPairingWindowTimer = setInterval(() => {
        const curUid = userUid || auth.currentUser?.uid;
        if (curUid) {
          refreshPhoneWatchPairingWindow(curUid, false).catch(() => {});
        }
      }, 60_000);
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
        clearInterval(pollWatchTimer);
        clearInterval(refreshPairingWindowTimer);
        unregisterBack();
      };
    } else if (dialog.open) {
      stopBleHeartRateScan();
      dialog.close();
    }
  }, [isOpen, userUid]);

  const handleCloseClick = () => {
    setTappedUnsupported(false);
    setIsSyncingWatch(false);
    stopBleHeartRateScan();
    if (dialogRef.current?.open) {
      dialogRef.current.close();
    } else {
      onClose();
    }
  };

  const handleSyncWatchPulseClick = () => {
    setIsSyncingWatch(true);
    const curUid = userUid || auth.currentUser?.uid;
    ensurePhoneWatchPairingReady(curUid);
    if (curUid) {
      refreshPhoneWatchPairingWindow(curUid, true).catch(() => {});
    }
    pingNativeWatch();
    requestWatchAppHeartRate();
    if (syncWatchTimerRef.current) {
      clearTimeout(syncWatchTimerRef.current);
    }
    syncWatchTimerRef.current = setTimeout(() => {
      syncWatchTimerRef.current = null;
      setIsSyncingWatch(false);
    }, 3500);
  };

  const handleRefreshPairingCodeClick = () => {
    const uid = userUid || auth.currentUser?.uid;
    if (!uid) return;
    setIsSyncingWatch(true);
    getOrCreatePhoneWatchPairingCode(uid, true)
      .then(() => {
        requestWatchAppHeartRate();
      })
      .finally(() => {
        setIsSyncingWatch(false);
      });
  };

  const nowMs = evalNowMs;
  const hasNativeWatchConnected =
    watchConnStatus.bridgeReady &&
    ((watchConnStatus.connectedNodesCount > 0 &&
      (watchConnStatus.watchAppInstalledCount ?? 0) > 0) ||
      (watchConnStatus.lastPongAt > 0 && nowMs - watchConnStatus.lastPongAt <= 3 * 60 * 1000) ||
      (watchConnStatus.lastMessageAt > 0 &&
        nowMs - watchConnStatus.lastMessageAt <= 3 * 60 * 1000));
  const hasCloudWatchConnected =
    cloudStatus.watchLinked &&
    cloudStatus.lastWatchSeenAt > 0 &&
    Math.abs(nowMs - cloudStatus.lastWatchSeenAt) <= 5 * 60 * 1000;
  const isWatchReachable = hasNativeWatchConnected || hasCloudWatchConnected;

  const isConnected = status.state === "connected";
  const isWearConnected = isConnected && status.source === "wear_os" && status.currentBpm >= 30;
  const isBleStrapConnected = isConnected && status.source === "ble";
  const isScanning = status.state === "scanning";
  const isExplicitConnecting = status.state === "connecting";
  const isReconnecting = status.state === "reconnecting";
  const isConnecting = isExplicitConnecting || isReconnecting;
  const isWatchSyncInFlight =
    isSyncingWatch || (status.source === "wear_os" && status.state === "connecting");

  const bleStrapDevices = status.discoveredDevices.filter(
    (dev) => !isLikelyCompanionSmartwatch(dev)
  );

  const statusBadgeText = isConnected
    ? tx("EN VIVO", "LIVE")
    : isConnecting || isWatchSyncInFlight
    ? tx("CONECTANDO", "CONNECTING")
    : isScanning
    ? t("bleHrScanning")
    : tx("EN ESPERA", "STANDBY");

  // Single-line crystal-clear live diagnostic (zero ambiguity, zero truncation)
  const diagnostic = (() => {
    if (!status.supported && tappedUnsupported) {
      return {
        dotColor: "bg-[#FF1E1E]",
        text: tx(
          "Activa el Bluetooth de tu teléfono para conectar.",
          "Turn on Bluetooth on your phone to connect."
        )
      };
    }
    if (isWearConnected) {
      return {
        dotColor: "bg-[#00C853]",
        text: hasCloudWatchConnected && !hasNativeWatchConnected
          ? tx(
              "Reloj conectado por nube · recibiendo pulso en vivo.",
              "Watch connected via cloud · receiving live pulse."
            )
          : tx(
              "Reloj conectado · recibiendo pulso en vivo.",
              "Watch connected · receiving live pulse."
            )
      };
    }
    if (isBleStrapConnected && status.currentBpm >= 30) {
      return {
        dotColor: "bg-[#00C853]",
        text: tx(
          "Banda Bluetooth conectada · recibiendo pulso en vivo.",
          "Bluetooth band connected · receiving live pulse."
        )
      };
    }
    if (status.contactDetected === false) {
      return {
        dotColor: "bg-[#FFE500]",
        text: tx(
          "Ajusta el reloj o banda sobre la piel para leer el pulso.",
          "Adjust the watch or band against your skin to read pulse."
        )
      };
    }
    if (status.errorCode === "WEAR_HR_PERMISSION_DENIED") {
      return {
        dotColor: "bg-[#FF1E1E]",
        text: tx(
          "Permite el sensor de pulso en la app del reloj.",
          "Allow the heart rate sensor in the watch app."
        )
      };
    }
    if (status.errorCode === "WEAR_HR_NO_SENSOR") {
      return {
        dotColor: "bg-[#FF1E1E]",
        text: tx(
          "El reloj conectado no reporta sensor de pulso disponible.",
          "Connected watch reports no available pulse sensor."
        )
      };
    }
    if (status.errorCode === "PERMISSION_DENIED") {
      return {
        dotColor: "bg-[#FF1E1E]",
        text: tx(
          "Permite el acceso a Bluetooth en Ajustes del teléfono.",
          "Allow Bluetooth access in phone Settings."
        )
      };
    }
    if (status.errorCode === "LOCATION_SERVICES_OFF") {
      return {
        dotColor: "bg-[#FFE500]",
        text: tx(
          "Activa la Ubicación del teléfono para detectar bandas.",
          "Turn on phone Location to detect bands."
        )
      };
    }
    if (status.errorCode === "HR_BROADCAST_NOT_ENABLED") {
      return {
        dotColor: "bg-[#FFE500]",
        text: tx(
          "Activa Transmitir pulso en los ajustes de tu banda.",
          "Enable Broadcast heart rate in your band settings."
        )
      };
    }
    if (isWatchSyncInFlight || isWatchReachable) {
      return {
        dotColor: "bg-[#00BFFF]",
        text: tx(
          "Reloj vinculado · abre ARCHERY 101010 en la muñeca para leer pulso.",
          "Watch linked · open ARCHERY 101010 on wrist to read pulse."
        )
      };
    }
    return {
      dotColor: "bg-[#8E96A4]",
      text: tx(
        "Sin vínculo activo · sincroniza tu reloj arriba o conecta una banda.",
        "No active link · sync your watch above or connect a band."
      )
    };
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
        className="w-full bg-[#04060A] border border-white/[0.15] rounded-[28px] p-4 sm:p-5 flex flex-col gap-3.5 relative select-none font-sans"
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
              className={`inline-flex items-center gap-1.5 rounded-full min-h-[25px] px-2.5 py-0.5 border text-[10px] min-[385px]:text-[10.8px] font-bold tracking-[0.04em] uppercase leading-tight ${
                isEs ? "shrink-0 whitespace-nowrap" : "min-w-0"
              } tabular-nums ${
                isConnected
                  ? "bg-[#051810] border-[#00C853]/65 text-white"
                  : isScanning || isConnecting || isWatchSyncInFlight
                  ? "bg-[#05121E] border-[#00BFFF]/65 text-white"
                  : "bg-[#0B0E15] border-white/[0.16] text-white"
              }`}
            >
              <span
                className={`w-[6px] h-[6px] rounded-full shrink-0 ${
                  isConnected
                    ? "bg-[#00C853]"
                    : isScanning || isConnecting || isWatchSyncInFlight
                    ? "bg-[#00BFFF]"
                    : "bg-[#8E96A4]"
                }`}
              />
              <span className={isEs ? undefined : "max-w-[128px] break-words leading-tight"}>
                {statusBadgeText}
              </span>
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

        {/* Title Block */}
        <h2
          id={titleId}
          className="text-[22px] sm:text-[24px] font-bold text-white tracking-normal leading-tight"
        >
          {t("bleHrTitle")}
        </h2>

        {/* Matte Titanium Live Heart Rate Telemetry Chassis */}
        <div className="bg-[#0B0E15] border border-white/[0.14] rounded-[22px] p-3.5 sm:p-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-extrabold tracking-[0.07em] uppercase text-white">
              {t("cardHeartRate")}
            </span>
            <div className="flex items-center gap-2 min-w-0">
              {status.deviceName && (
                <span className="text-[12.5px] font-bold text-[#00BFFF] break-words leading-tight max-w-[175px] tabular-nums">
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
                  isEs ? "text-[42px]" : "text-[36px] min-[385px]:text-[42px]"
                } font-extrabold leading-none text-white tabular-nums`}
              >
                {isConnected && status.currentBpm >= 30 ? status.currentBpm : "—"}
              </span>
              <span className="text-[14px] font-extrabold uppercase tracking-wider text-[#FF1E1E]">
                BPM
              </span>
            </div>

            <div
              className={`bg-[#05070B] border border-white/[0.13] rounded-2xl px-2.5 py-2 text-center flex flex-col justify-center gap-0.5 min-h-[58px]${
                isEs ? "" : " min-w-0"
              }`}
            >
              <span
                className={
                  isEs
                    ? "text-[11px] font-bold tracking-[0.06em] uppercase text-white block"
                    : "break-words leading-tight w-full text-center text-[10px] min-[385px]:text-[11px] font-bold tracking-[0.06em] uppercase text-white block"
                }
              >
                {isEs ? tx("PROMEDIO", "AVERAGE") : t("cardAverage")}
              </span>
              <span className="text-[17px] font-extrabold text-white tabular-nums leading-tight block">
                {status.avgHeartRateBpm >= 30 ? status.avgHeartRateBpm : "—"}
              </span>
            </div>

            <div
              className={`bg-[#05070B] border border-white/[0.13] rounded-2xl px-2.5 py-2 text-center flex flex-col justify-center gap-0.5 min-h-[58px]${
                isEs ? "" : " min-w-0"
              }`}
            >
              <span
                className={
                  isEs
                    ? "text-[11px] font-bold tracking-[0.06em] uppercase text-white block"
                    : "break-words leading-tight w-full text-center text-[10px] min-[385px]:text-[11px] font-bold tracking-[0.06em] uppercase text-white block"
                }
              >
                {tx("MÁXIMO", "PEAK")}
              </span>
              <span className="text-[17px] font-extrabold text-[#FFE500] tabular-nums leading-tight block">
                {status.maxHeartRateBpm >= 30 ? status.maxHeartRateBpm : "—"}
              </span>
            </div>
          </div>

          {/* Clear 1-Line Live Diagnostic Bar */}
          <div
            role="status"
            className="bg-[#06080D] border border-white/[0.10] rounded-xl px-3 py-2 flex items-center gap-2"
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${diagnostic.dotColor}`} />
            <span className="text-[12.5px] font-semibold text-white leading-snug break-words">
              {diagnostic.text}
            </span>
          </div>
        </div>

        {/* BLOCK 1: DEDICATED LINKED WATCH SECTION (ARCHERY 101010 WATCH APP) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-extrabold uppercase tracking-[0.08em] text-[#00BFFF] px-0.5">
            {tx("1 · RELOJ VINCULADO (ARCHERY 101010)", "1 · LINKED WATCH (ARCHERY 101010)")}
          </span>
          <div className="bg-[#0B0E15] border border-white/[0.14] rounded-2xl px-3.5 py-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#07131F] border border-[#00BFFF]/40 flex items-center justify-center shrink-0">
                  <Watch size={17} className="text-[#00BFFF]" aria-hidden="true" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[14.5px] font-bold text-white leading-tight break-words">
                    {tx("Reloj Inteligente", "Smartwatch")}
                  </span>
                  <span
                    className={`text-[11.5px] font-bold uppercase tracking-wider leading-tight break-words mt-0.5 tabular-nums ${
                      isWearConnected
                        ? "text-[#00C853]"
                        : isWatchReachable
                        ? "text-[#00BFFF]"
                        : "text-[#94A3B8]"
                    }`}
                  >
                    {isWearConnected
                      ? `${tx("● En vivo", "● Live")} · ${status.currentBpm} BPM`
                      : hasNativeWatchConnected
                      ? tx("● Conectado por Bluetooth", "● Connected via Bluetooth")
                      : hasCloudWatchConnected
                      ? tx("● Conectado por código", "● Connected via code")
                      : cloudStatus.pairingCode
                      ? `${tx("Código activo", "Active code")}: ${cloudStatus.pairingCode.slice(0, 3)} ${cloudStatus.pairingCode.slice(3)}`
                      : tx("App del reloj", "Watch app")}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={isWatchSyncInFlight}
                onClick={handleSyncWatchPulseClick}
                className={`min-h-[40px] px-3.5 rounded-xl font-bold text-[12.5px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-65 ${
                  isWearConnected
                    ? "bg-[#051810] border border-[#00C853]/65 text-white"
                    : "bg-[#00BFFF] hover:brightness-105 text-black"
                }`}
              >
                {isWearConnected
                  ? tx("En vivo", "Live")
                  : isWatchSyncInFlight
                  ? tx("Sincronizando", "Syncing")
                  : tx("Sincronizar", "Sync")}
              </button>
            </div>

            {!isWearConnected && cloudStatus.pairingCode && (
              <div className="bg-[#06080D] border border-white/[0.11] rounded-xl px-3 py-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#94A3B8] leading-tight break-words">
                      {tx(
                        "Código para pantalla VINCULAR (pantalla 5) del reloj",
                        "Code for watch LINK screen (screen 5)"
                      )}
                    </span>
                    <span
                      dir="ltr"
                      className="text-[18px] font-extrabold tracking-[0.14em] text-[#FFE500] tabular-nums leading-tight mt-0.5"
                    >
                      {`${cloudStatus.pairingCode.slice(0, 3)} ${cloudStatus.pairingCode.slice(3)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isWatchSyncInFlight}
                    onClick={handleRefreshPairingCodeClick}
                    className="min-h-[34px] px-2.5 rounded-lg bg-[#11151F] border border-white/[0.14] text-white text-[11.5px] font-bold uppercase tracking-wider shrink-0 cursor-pointer hover:bg-white/10 transition disabled:opacity-60"
                  >
                    {tx("Nuevo", "New")}
                  </button>
                </div>
                <span className="text-[11px] font-medium text-[#CBD5E1] leading-snug break-words">
                  {tx(
                    "Con la app compañera Bluetooth activa en tu teléfono, abre ARCHERY 101010 en tu Reloj Deportivo GPS o Reloj Inteligente e ingresa este código.",
                    "With the Bluetooth companion app active on your phone, open ARCHERY 101010 on your GPS Sports Watch or Smartwatch and enter this code."
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* BLOCK 2: DEDICATED BLUETOOTH CHEST STRAPS & ARMBANDS SECTION */}
        {status.transport === "native_android" && !isBleStrapConnected && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-0.5 gap-2">
              <span className="text-[12px] font-extrabold uppercase tracking-[0.08em] text-white">
                {tx("2 · BANDAS Y SENSORES BLUETOOTH", "2 · BLUETOOTH BANDS & SENSORS")}
              </span>
              <span className="text-[12px] font-bold text-[#94A3B8] tabular-nums shrink-0">
                {isScanning
                  ? t("bleHrScanning")
                  : `${bleStrapDevices.length} ${tx("disp.", "dev.")}`}
              </span>
            </div>

            {bleStrapDevices.length === 0 ? (
              <div className="bg-[#090C12] border border-white/[0.11] rounded-2xl px-3.5 py-3 text-center text-[13.5px] font-medium text-[#CBD5E1] leading-snug">
                {isScanning
                  ? tx(
                      "Buscando bandas pectorales o brazaletes Bluetooth",
                      "Scanning for Bluetooth chest straps or armbands"
                    )
                  : tx(
                      "Exclusivo para bandas pectorales o brazaletes con pulso Bluetooth.",
                      "For Bluetooth chest straps or heart rate armbands only."
                    )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[168px] overflow-y-auto pr-0.5">
                {bleStrapDevices.map((dev) => {
                  const isThisConnecting = isConnecting && status.deviceId === dev.id;
                  return (
                    <div
                      key={dev.id}
                      className="bg-[#0B0E15] border border-white/[0.14] rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2.5"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-[15px] font-bold text-white break-words leading-tight">
                          {dev.name}
                        </span>
                        <div className={`flex items-center gap-1.5 mt-0.5${isEs ? "" : " min-w-0"}`}>
                          {dev.hasHrService ? (
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-[#00C853]">
                              {tx("● PULSO ACTIVO", "● HR READY")}
                            </span>
                          ) : (
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-[#94A3B8]">
                              BLUETOOTH LE
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isThisConnecting}
                        onClick={() => connectBleHeartRateDevice(dev.id, dev.name)}
                        className={`min-h-[40px] px-3.5 rounded-xl bg-[#141925] border border-white/[0.16] hover:border-[#00BFFF]/60 text-white font-bold text-[13px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-60${
                          isEs ? "" : " max-w-[132px] break-words leading-tight"
                        }`}
                      >
                        {isThisConnecting ? tx("Conectando", "Connecting") : t("bleHrConnect")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer Actions — 100% In-App */}
        <div className="flex items-center gap-2.5 pt-0.5">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={() => disconnectBleHeartRateDevice(true)}
                className="flex-1 min-h-[50px] rounded-2xl bg-[#180709] border border-[#FF1E1E]/65 text-white font-bold text-[14.5px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
              >
                {t("bleHrDisconnect")}
              </button>
              <button
                type="button"
                onClick={handleCloseClick}
                className="flex-1 min-h-[50px] rounded-2xl bg-[#00BFFF] hover:brightness-105 text-black font-bold text-[15px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
              >
                {tx("Listo", "Done")}
              </button>
            </>
          ) : (
            <div className="w-full flex items-center gap-2.5">
              {Boolean(status.deviceId) &&
                status.source === "ble" &&
                (isReconnecting || isExplicitConnecting) && (
                  <button
                    type="button"
                    onClick={() => disconnectBleHeartRateDevice(true)}
                    className="min-h-[50px] px-4 rounded-2xl bg-[#180709] border border-[#FF1E1E]/65 text-white font-bold text-[13.5px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-[0.99] transition"
                  >
                    {tx("Olvidar", "Forget")}
                  </button>
                )}
              <button
                type="button"
                disabled={isExplicitConnecting || isScanning}
                onClick={handleScanOrPairClick}
                className="flex-1 min-h-[50px] rounded-2xl bg-[#141925] border border-white/[0.16] hover:border-[#00BFFF]/55 text-white font-bold text-[14.5px] uppercase tracking-[0.04em] cursor-pointer active:scale-[0.99] transition disabled:opacity-60"
              >
                {isScanning
                  ? t("bleHrScanning")
                  : tx("Buscar banda Bluetooth", "Scan Bluetooth band")}
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
