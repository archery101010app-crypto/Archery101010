"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Activity, RotateCcw, Watch, X } from "lucide-react";
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
      requestWatchAppHeartRate({ force: true });
      pingNativeWatch();
      const pollWatchTimer = setInterval(() => {
        setEvalNowMs(Date.now());
        requestWatchAppHeartRate({ unmute: false });
        pingNativeWatch();
      }, 6000);
      const refreshPairingWindowTimer = setInterval(() => {
        const curUid = userUid || auth.currentUser?.uid;
        if (curUid) {
          refreshPhoneWatchPairingWindow(curUid, false).catch(() => {});
        }
      }, 60_000);
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
    requestWatchAppHeartRate({ force: true });
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
  const isWatchWarmingUp =
    !isWearConnected && status.source === "wear_os" && status.state === "connecting";
  const isExplicitConnecting = status.state === "connecting" && status.source !== "wear_os";
  const isReconnecting = status.state === "reconnecting";
  const isConnecting = isExplicitConnecting || isReconnecting;
  const isWatchSyncInFlight = isSyncingWatch;

  const bleStrapDevices = status.discoveredDevices.filter(
    (dev) => !isLikelyCompanionSmartwatch(dev)
  );

  const statusBadgeText = isConnected
    ? tx("EN VIVO", "LIVE")
    : isWatchWarmingUp
    ? tx("MIDIENDO PULSO", "MEASURING PULSE")
    : isConnecting || isWatchSyncInFlight
    ? tx("CONECTANDO", "CONNECTING")
    : isScanning
    ? t("bleHrScanning")
    : tx("EN ESPERA", "STANDBY");

  // Concise 1-line status indicator for Hero Pulse card (zero clutter, zero truncation)
  const diagnostic = (() => {
    if (!status.supported && tappedUnsupported) {
      return {
        dotColor: "bg-[#FF1E1E]",
        text: tx("Activa el Bluetooth", "Turn on Bluetooth")
      };
    }
    if (isWearConnected || (isBleStrapConnected && status.currentBpm >= 30)) {
      return {
        dotColor: "bg-[#00C853]",
        text: tx("En vivo", "Live")
      };
    }
    if (status.contactDetected === false) {
      return {
        dotColor: "bg-[#FFE500]",
        text: tx("Ajusta sobre la piel", "Adjust against skin")
      };
    }
    if (isWatchWarmingUp) {
      return {
        dotColor: "bg-[#00A8F3]",
        text: tx("Midiendo pulso", "Measuring pulse")
      };
    }
    if (status.errorCode === "WEAR_HR_PERMISSION_DENIED") {
      return {
        dotColor: "bg-[#FF1E1E]",
        text: tx("Permite pulso en reloj", "Allow pulse on watch")
      };
    }
    if (status.errorCode === "WEAR_HR_NO_SENSOR") {
      return {
        dotColor: "bg-[#FF1E1E]",
        text: tx("Sin sensor disponible", "No sensor available")
      };
    }
    if (status.errorCode === "PERMISSION_DENIED") {
      return {
        dotColor: "bg-[#FF1E1E]",
        text: tx("Permite Bluetooth", "Allow Bluetooth")
      };
    }
    if (status.errorCode === "LOCATION_SERVICES_OFF") {
      return {
        dotColor: "bg-[#FFE500]",
        text: tx("Activa Ubicación", "Turn on Location")
      };
    }
    if (status.errorCode === "HR_BROADCAST_NOT_ENABLED") {
      return {
        dotColor: "bg-[#FFE500]",
        text: tx("Activa transmitir pulso", "Enable HR broadcast")
      };
    }
    if (isScanning) {
      return {
        dotColor: "bg-[#00A8F3]",
        text: t("bleHrScanning")
      };
    }
    if (isWatchSyncInFlight || isConnecting) {
      return {
        dotColor: "bg-[#00A8F3]",
        text: tx("Sincronizando", "Syncing")
      };
    }
    if (isWatchReachable) {
      return {
        dotColor: "bg-[#00A8F3]",
        text: tx("Reloj vinculado", "Watch linked")
      };
    }
    return {
      dotColor: "bg-[#00A8F3]",
      text: tx("En espera", "Standby")
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
      className="m-auto w-[calc(100vw-16px)] max-w-[412px] max-h-[94dvh] p-0 bg-transparent border-0 text-white font-sans overflow-y-auto overscroll-contain outline-none open:block"
    >
      <div
        dir={isEs ? "ltr" : undefined}
        className="w-full bg-[#06080C] border border-white/[0.12] rounded-[28px] p-4 sm:p-5 flex flex-col gap-3.5 relative select-none font-sans"
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
          <div dir="ltr" className="flex items-center gap-2.5 min-w-0">
            <img
              src="/images/brand_logo_header.png"
              srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
              alt="ARCHERY 101010"
              className="h-[13.5px] sm:h-[14px] w-auto object-contain shrink-0 select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]"
              draggable={false}
            />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full min-h-[26px] px-2.5 py-0.5 border text-[10.5px] font-bold tracking-[0.06em] uppercase leading-tight tabular-nums ${
                isConnected
                  ? "bg-[#051810] border-[#00C853]/65 text-white"
                  : "bg-[#0B0F17] border-[#00A8F3]/45 text-white"
              }`}
            >
              <span
                className={`w-[6px] h-[6px] rounded-full shrink-0 ${
                  isConnected ? "bg-[#00C853]" : "bg-[#00A8F3]"
                }`}
              />
              <span>{isConnected ? statusBadgeText : tx("PULSO", "PULSE")}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={handleCloseClick}
            aria-label={tx("Cerrar sensor de pulso", "Close heart rate sensor")}
            className="min-w-[38px] min-h-[38px] w-[38px] h-[38px] rounded-full bg-[#0E121B] border border-white/[0.12] text-white flex items-center justify-center hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        {/* Hero Pulse Readout Card */}
        <div className="bg-[#0A0D14] border border-white/[0.10] rounded-[22px] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2
              id={titleId}
              className="text-[11.5px] font-extrabold tracking-[0.08em] uppercase text-white leading-tight"
            >
              {t("cardHeartRate")}
            </h2>
            <div
              role="status"
              className="inline-flex items-center gap-1.5 min-w-0"
            >
              <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${diagnostic.dotColor}`} />
              <span className="text-[12px] font-semibold text-white leading-tight break-words">
                {status.deviceName && isConnected ? status.deviceName : diagnostic.text}
              </span>
              {typeof status.batteryPct === "number" && (
                <span className="text-[11px] font-bold text-white bg-[#121621] border border-white/[0.14] px-1.5 py-0.5 rounded-md tabular-nums shrink-0">
                  {status.batteryPct}%
                </span>
              )}
            </div>
          </div>

          <div
            className={`grid ${
              isEs ? "grid-cols-[1.15fr_1fr_1fr]" : "grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]"
            } gap-2.5 items-center`}
          >
            <div dir="ltr" className="flex items-baseline gap-2 pl-0.5">
              <span className="font-sans text-[42px] font-extrabold leading-none tracking-[0.04em] text-white tabular-nums">
                {isConnected && status.currentBpm >= 30 ? status.currentBpm : "--"}
              </span>
              <span className="text-[13px] font-extrabold uppercase tracking-[0.06em] text-[#FF1E1E]">
                BPM
              </span>
            </div>

            <div className="bg-[#06080C] border border-white/[0.10] rounded-2xl px-2 py-2.5 text-center flex flex-col justify-center gap-0.5 min-h-[58px] min-w-0">
              <span className="text-[10px] font-bold tracking-[0.07em] uppercase text-white leading-tight break-words block">
                {isEs ? tx("PROMEDIO", "AVERAGE") : t("cardAverage")}
              </span>
              <span className="text-[18px] font-extrabold tracking-[0.04em] text-white tabular-nums leading-tight block">
                {status.avgHeartRateBpm >= 30 ? status.avgHeartRateBpm : "--"}
              </span>
            </div>

            <div className="bg-[#06080C] border border-white/[0.10] rounded-2xl px-2 py-2.5 text-center flex flex-col justify-center gap-0.5 min-h-[58px] min-w-0">
              <span className="text-[10px] font-bold tracking-[0.07em] uppercase text-white leading-tight break-words block">
                {tx("MÁXIMO", "PEAK")}
              </span>
              <span className="text-[18px] font-extrabold tracking-[0.04em] text-[#FFE500] tabular-nums leading-tight block">
                {status.maxHeartRateBpm >= 30 ? status.maxHeartRateBpm : "--"}
              </span>
            </div>
          </div>
        </div>

        {/* Option 1: Smartwatch Card */}
        <div className="bg-[#0A0D14] border border-white/[0.10] rounded-[22px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-[42px] h-[42px] rounded-[14px] bg-[#07121E] border border-[#00A8F3]/40 flex items-center justify-center shrink-0">
                <Watch size={20} className="text-[#00A8F3]" aria-hidden="true" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[16px] font-bold text-white leading-tight break-words">
                  {tx("Reloj Inteligente", "Smartwatch")}
                </span>
                <span
                  className={`text-[12.5px] font-medium leading-tight break-words mt-0.5 tabular-nums ${
                    isWearConnected
                      ? "text-[#00C853]"
                      : isWatchReachable
                      ? "text-[#00A8F3]"
                      : "text-[#CBD5E1]"
                  }`}
                >
                  {isWearConnected
                    ? `${tx("● En vivo", "● Live")} · ${status.currentBpm} BPM`
                    : hasNativeWatchConnected && isWatchWarmingUp
                    ? tx("Midiendo en muñeca", "Measuring on wrist")
                    : isWatchReachable
                    ? tx("Conectado", "Connected")
                    : tx("Sensor de muñeca", "Wrist sensor")}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={isWatchSyncInFlight}
              onClick={handleSyncWatchPulseClick}
              className={`min-h-[40px] px-3.5 rounded-[13px] font-extrabold text-[12px] uppercase tracking-[0.05em] shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-65 ${
                isWearConnected
                  ? "bg-[#051810] border border-[#00C853]/65 text-white"
                  : "bg-[#00A8F3] hover:brightness-105 text-[#020305]"
              }`}
            >
              {isWearConnected
                ? tx("En vivo", "Live")
                : isWatchSyncInFlight
                ? tx("Sincronizando", "Syncing")
                : isWatchWarmingUp
                ? tx("Reintentar", "Retry")
                : tx("Sincronizar", "Sync")}
            </button>
          </div>

          {!isWearConnected && cloudStatus.pairingCode && (
            <div className="bg-[#06080C] border border-white/[0.09] rounded-[15px] px-3 py-2.5 flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-white shrink-0">
                  {tx("CÓDIGO", "CODE")}
                </span>
                <span
                  dir="ltr"
                  className="text-[19px] font-extrabold tracking-[0.12em] text-[#FFE500] tabular-nums leading-none"
                >
                  {`${cloudStatus.pairingCode.slice(0, 3)} ${cloudStatus.pairingCode.slice(3)}`}
                </span>
              </div>
              <button
                type="button"
                disabled={isWatchSyncInFlight}
                onClick={handleRefreshPairingCodeClick}
                className="min-h-[30px] px-2.5 rounded-[9px] bg-[#10141E] border border-white/[0.14] text-white text-[11px] font-bold uppercase tracking-[0.05em] inline-flex items-center gap-1 shrink-0 cursor-pointer hover:bg-white/10 transition disabled:opacity-60"
              >
                <RotateCcw size={11} aria-hidden="true" />
                <span>{tx("Nuevo", "New")}</span>
              </button>
            </div>
          )}
        </div>

        {/* Option 2: Bluetooth Card */}
        <div className="bg-[#0A0D14] border border-white/[0.10] rounded-[22px] p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-[42px] h-[42px] rounded-[14px] bg-[#0E121B] border border-white/[0.14] flex items-center justify-center shrink-0">
                <Activity size={20} className="text-white" aria-hidden="true" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[16px] font-bold text-white leading-tight break-words">
                  Bluetooth
                </span>
                {isBleStrapConnected && status.deviceName && (
                  <span className="text-[12px] font-semibold text-[#00C853] leading-tight break-words mt-0.5">
                    {status.deviceName}
                  </span>
                )}
              </div>
            </div>

            {isBleStrapConnected ? (
              <button
                type="button"
                onClick={() => disconnectBleHeartRateDevice(true)}
                className="min-h-[40px] px-3.5 rounded-[13px] bg-[#180709] border border-[#FF1E1E]/65 text-white font-extrabold text-[12px] uppercase tracking-[0.05em] shrink-0 cursor-pointer active:scale-95 transition"
              >
                {t("bleHrDisconnect")}
              </button>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                {Boolean(status.deviceId) &&
                  status.source === "ble" &&
                  (isReconnecting || isExplicitConnecting) && (
                    <button
                      type="button"
                      onClick={() => disconnectBleHeartRateDevice(true)}
                      className="min-h-[40px] px-3 rounded-[13px] bg-[#180709] border border-[#FF1E1E]/65 text-white font-extrabold text-[11.5px] uppercase tracking-[0.04em] cursor-pointer active:scale-95 transition"
                    >
                      {tx("Olvidar", "Forget")}
                    </button>
                  )}
                <button
                  type="button"
                  disabled={isExplicitConnecting || isScanning}
                  onClick={handleScanOrPairClick}
                  className="min-h-[40px] px-4 rounded-[13px] bg-[#121722] border border-white/[0.16] hover:border-[#00A8F3]/55 text-white font-extrabold text-[12px] uppercase tracking-[0.05em] cursor-pointer active:scale-95 transition disabled:opacity-60"
                >
                  {isScanning ? t("bleHrScanning") : tx("Buscar", "Scan")}
                </button>
              </div>
            )}
          </div>

          {!isBleStrapConnected && bleStrapDevices.length > 0 && (
            <div className="flex flex-col gap-2 max-h-[156px] overflow-y-auto pt-0.5 pr-0.5">
              {bleStrapDevices.map((dev) => {
                const isThisConnecting = isConnecting && status.deviceId === dev.id;
                return (
                  <div
                    key={dev.id}
                    className="bg-[#06080C] border border-white/[0.10] rounded-2xl px-3 py-2.5 flex items-center justify-between gap-2.5"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-[14.5px] font-bold text-white break-words leading-tight">
                        {dev.name}
                      </span>
                      <span
                        className={`text-[11px] font-bold uppercase tracking-wider mt-0.5 ${
                          dev.hasHrService ? "text-[#00C853]" : "text-[#94A3B8]"
                        }`}
                      >
                        {dev.hasHrService ? tx("● PULSO ACTIVO", "● HR READY") : "BLUETOOTH LE"}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isThisConnecting}
                      onClick={() => connectBleHeartRateDevice(dev.id, dev.name)}
                      className="min-h-[36px] px-3 rounded-xl bg-[#141925] border border-white/[0.16] hover:border-[#00A8F3]/60 text-white font-bold text-[12px] uppercase tracking-wider shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-60"
                    >
                      {isThisConnecting ? tx("Conectando", "Connecting") : t("bleHrConnect")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {isWearConnected && (
          <div className="flex items-center gap-2.5 pt-0.5">
            <button
              type="button"
              onClick={() => disconnectBleHeartRateDevice(true)}
              className="flex-1 min-h-[46px] rounded-2xl bg-[#180709] border border-[#FF1E1E]/65 text-white font-bold text-[13.5px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
            >
              {t("bleHrDisconnect")}
            </button>
            <button
              type="button"
              onClick={handleCloseClick}
              className="flex-1 min-h-[46px] rounded-2xl bg-[#00A8F3] hover:brightness-105 text-[#020305] font-extrabold text-[14px] uppercase tracking-wider cursor-pointer active:scale-[0.99] transition"
            >
              {tx("Listo", "Done")}
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
