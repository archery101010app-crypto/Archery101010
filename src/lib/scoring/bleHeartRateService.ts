export const BLE_HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
export const BLE_HR_MEASUREMENT_CHAR_UUID = "00002a37-0000-1000-8000-00805f9b34fb";
export const BLE_BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
export const BLE_BATTERY_LEVEL_CHAR_UUID = "00002a19-0000-1000-8000-00805f9b34fb";

const STORAGE_KEY_SAVED_SENSOR = "archery101010_ble_hr_saved_v1";

export type BleHrConnectionState =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unsupported"
  | "error";

export interface BleHrDiscoveredDevice {
  id: string;
  name: string;
  rssi?: number;
  hasHrService?: boolean;
  isBondedOrConnected?: boolean;
}

export interface ParsedHeartRatePacket {
  bpm: number;
  isUint16: boolean;
  contactDetected: boolean | null;
  energyExpendedKj: number | null;
  rrIntervalsMs: number[];
  validPhysiological: boolean;
}

export type HeartRateSource = "ble" | "wear_os";

/**
 * Smartwatches paired to the phone (bonded, named "...Watch...") that do NOT advertise the
 * standard 0x180D Heart Rate Service cannot stream pulse over plain Bluetooth. Their live pulse
 * arrives through the ARCHERY 101010 watch app instead (Wearable Data Layer).
 */
export function isLikelyCompanionSmartwatch(dev: BleHrDiscoveredDevice | null | undefined): boolean {
  if (!dev || dev.hasHrService) return false;
  return (
    Boolean(dev.isBondedOrConnected) &&
    /(?:\bwatch|watch\d|\breloj\b|galaxy\s*fit|wear\s*os)/i.test(String(dev.name || ""))
  );
}

export interface BleHeartRateStatus {
  transport: "native_android" | "web_bluetooth" | "unsupported";
  supported: boolean;
  /** Where live pulse samples currently come from: a BLE sensor or the ARCHERY 101010 watch app. */
  source: HeartRateSource;
  state: BleHrConnectionState;
  deviceId: string;
  deviceName: string;
  currentBpm: number;
  avgHeartRateBpm: number;
  maxHeartRateBpm: number;
  batteryPct: number | null;
  contactDetected: boolean | null;
  lastSampleAt: number;
  discoveredDevices: BleHrDiscoveredDevice[];
  errorCode: string;
}

export function isValidHeartRateBpm(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm >= 30 && bpm <= 245;
}

/**
 * Parses a standard Bluetooth SIG Heart Rate Measurement (UUID 0x2A37) payload.
 * Spec: Heart Rate Service 1.0 (GATT Specification Supplement).
 */
export function parseHeartRateMeasurement(
  rawBytes: Uint8Array | ArrayLike<number> | null | undefined
): ParsedHeartRatePacket | null {
  if (!rawBytes || rawBytes.length < 2) return null;

  const flags = rawBytes[0] & 0xff;
  const isUint16 = (flags & 0x01) !== 0;

  let offset = 1;
  let bpm = 0;
  if (isUint16) {
    if (rawBytes.length < 3) return null;
    bpm = (rawBytes[1] & 0xff) | ((rawBytes[2] & 0xff) << 8);
    offset = 3;
  } else {
    bpm = rawBytes[1] & 0xff;
    offset = 2;
  }

  // Bits 1..2: Sensor Contact Status
  // 0 or 1 = not supported, 2 = supported & NOT detected, 3 = supported & detected
  const contactBits = (flags >> 1) & 0x03;
  const contactDetected: boolean | null =
    contactBits === 2 ? false : contactBits === 3 ? true : null;

  // Bit 3: Energy Expended Present (UINT16, kJ)
  let energyExpendedKj: number | null = null;
  if ((flags & 0x08) !== 0) {
    if (rawBytes.length >= offset + 2) {
      energyExpendedKj = (rawBytes[offset] & 0xff) | ((rawBytes[offset + 1] & 0xff) << 8);
      offset += 2;
    } else {
      offset = rawBytes.length;
    }
  }

  // Bit 4: RR-Interval values present (UINT16 in 1/1024 second units)
  const rrIntervalsMs: number[] = [];
  if ((flags & 0x10) !== 0) {
    while (offset + 1 < rawBytes.length) {
      const rawRr = (rawBytes[offset] & 0xff) | ((rawBytes[offset + 1] & 0xff) << 8);
      offset += 2;
      if (rawRr > 0) {
        rrIntervalsMs.push(Math.round((rawRr / 1024) * 1000));
      }
    }
  }

  const validPhysiological = contactDetected !== false && isValidHeartRateBpm(bpm);

  return {
    bpm,
    isUint16,
    contactDetected,
    energyExpendedKj,
    rrIntervalsMs,
    validPhysiological
  };
}

/**
 * Pure session accumulator for live BPM, sample-weighted session average BPM, and peak BPM.
 */
export class BleHeartRateSessionTracker {
  private sumBpm = 0;
  private sampleCount = 0;
  private currentBpmVal = 0;
  private avgBpmVal = 0;
  private maxBpmVal = 0;
  private lastSampleAtMs = 0;

  recordSample(
    bpm: number,
    contactDetected: boolean | null = null,
    timestampMs: number = Date.now()
  ): boolean {
    if (contactDetected === false || !isValidHeartRateBpm(bpm)) {
      this.currentBpmVal = 0;
      return false;
    }
    const rounded = Math.round(bpm);
    this.currentBpmVal = rounded;
    this.sumBpm += rounded;
    this.sampleCount += 1;
    this.avgBpmVal = Math.round(this.sumBpm / this.sampleCount);
    if (rounded > this.maxBpmVal) {
      this.maxBpmVal = rounded;
    }
    this.lastSampleAtMs = timestampMs;
    return true;
  }

  resetSessionStats(seedAvgBpm = 0, seedMaxBpm = 0, seedSampleCount = 1): void {
    const cleanAvg = isValidHeartRateBpm(seedAvgBpm) ? Math.round(seedAvgBpm) : 0;
    const cleanMax = isValidHeartRateBpm(seedMaxBpm)
      ? Math.max(cleanAvg, Math.round(seedMaxBpm))
      : cleanAvg;
    const count = cleanAvg > 0 ? Math.max(1, Math.round(seedSampleCount) || 1) : 0;
    this.sumBpm = cleanAvg * count;
    this.sampleCount = count;
    this.avgBpmVal = cleanAvg;
    this.maxBpmVal = cleanMax;
  }

  clearCurrentReading(): void {
    this.currentBpmVal = 0;
  }

  syncCompanionSummary(avgBpm?: number, maxBpm?: number): void {
    if (typeof maxBpm === "number" && isValidHeartRateBpm(maxBpm)) {
      const cleanMax = Math.round(maxBpm);
      if (cleanMax > this.maxBpmVal) {
        this.maxBpmVal = cleanMax;
      }
    }
    if (
      this.sampleCount <= 1 &&
      typeof avgBpm === "number" &&
      isValidHeartRateBpm(avgBpm)
    ) {
      const cleanAvg = Math.round(avgBpm);
      this.avgBpmVal = cleanAvg;
      if (this.sampleCount === 0) {
        this.sumBpm = cleanAvg;
        this.sampleCount = 1;
      }
      if (cleanAvg > this.maxBpmVal) {
        this.maxBpmVal = cleanAvg;
      }
    }
  }

  getSnapshot(nowMs?: number, staleWindowMs = 12_000) {
    const isStale =
      typeof nowMs === "number" &&
      this.lastSampleAtMs > 0 &&
      nowMs - this.lastSampleAtMs > staleWindowMs;
    return {
      currentBpm: isStale ? 0 : this.currentBpmVal,
      avgHeartRateBpm: this.avgBpmVal,
      maxHeartRateBpm: this.maxBpmVal,
      samplesCount: this.sampleCount,
      lastSampleAt: this.lastSampleAtMs
    };
  }
}

interface NativeBleBridge {
  startScan: () => void;
  stopScan: () => void;
  connectDevice: (address: string, name?: string) => void;
  disconnectDevice: (forget?: boolean) => void;
  tryAutoReconnectSaved?: () => void;
  getStatusJson?: () => string;
  requestWatchHeartRate?: () => void;
  getLastWearHeartRateJson?: () => string;
}

const sessionTracker = new BleHeartRateSessionTracker();
const listeners = new Set<(status: BleHeartRateStatus) => void>();

let statusState: BleHeartRateStatus = {
  transport: "unsupported",
  supported: false,
  source: "ble",
  state: "disconnected",
  deviceId: "",
  deviceName: "",
  currentBpm: 0,
  avgHeartRateBpm: 0,
  maxHeartRateBpm: 0,
  batteryPct: null,
  contactDetected: null,
  lastSampleAt: 0,
  discoveredDevices: [],
  errorCode: ""
};

let initialized = false;
let webBleDevice: any = null;
let webBleHrChar: any = null;
let webUserDisconnected = false;
let webReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let staleSampleWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
let lastNativeScanStartedAt = 0;

// ── Watch-app pulse channel (ARCHERY 101010 watch app → phone via Wearable Data Layer or 6-Digit Cloud) ──
const WEAR_HR_LIVE_WINDOW_MS = 35_000;
let wearHrLastAt = 0;
let wearHrMuted = false;
let wearHrTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let wearConnectFallbackTimer: ReturnType<typeof setTimeout> | null = null;

function isWearHrLive(nowMs = Date.now()): boolean {
  return statusState.source === "wear_os" && nowMs - wearHrLastAt < WEAR_HR_LIVE_WINDOW_MS;
}

function armWearHrTimeout(): void {
  if (wearHrTimeoutTimer) clearTimeout(wearHrTimeoutTimer);
  wearHrTimeoutTimer = setTimeout(() => {
    wearHrTimeoutTimer = null;
    if (statusState.source !== "wear_os") return;
    if (Date.now() - wearHrLastAt < WEAR_HR_LIVE_WINDOW_MS) {
      armWearHrTimeout();
      return;
    }
    sessionTracker.clearCurrentReading();
    statusState.source = "ble";
    statusState.state = "disconnected";
    statusState.contactDetected = null;
    emitStatus();
  }, WEAR_HR_LIVE_WINDOW_MS);
}

function applyWearPayload(payload: any): void {
  if (!payload || typeof payload !== "object" || wearHrMuted) return;
  // A dedicated BLE sensor that is already streaming always keeps priority
  const bleLive = statusState.state === "connected" && statusState.source === "ble";
  const wearStatus = String(payload.status || "ok");
  const wearName =
    typeof payload.deviceName === "string" && payload.deviceName.trim()
      ? payload.deviceName.trim()
      : "";

  if (wearStatus !== "ok") {
    if (bleLive) return;
    if (wearStatus === "reading") {
      if (!isWearHrLive()) {
        statusState.source = "wear_os";
        statusState.state = "connecting";
        statusState.errorCode = "";
        if (wearName) statusState.deviceName = wearName;
        emitStatus();
      }
      return;
    }
    if (wearConnectFallbackTimer) {
      clearTimeout(wearConnectFallbackTimer);
      wearConnectFallbackTimer = null;
    }
    if (wearStatus === "no_contact") {
      statusState.contactDetected = false;
      sessionTracker.clearCurrentReading();
    } else if (wearStatus === "permission_denied") {
      if (statusState.source === "wear_os") statusState.state = "disconnected";
      statusState.errorCode = "WEAR_HR_PERMISSION_DENIED";
    } else if (wearStatus === "no_sensor") {
      if (statusState.source === "wear_os") statusState.state = "disconnected";
      statusState.errorCode = "WEAR_HR_NO_SENSOR";
    }
    if (wearName && statusState.source === "wear_os") statusState.deviceName = wearName;
    emitStatus();
    return;
  }

  const bpm = Number(payload.bpm);
  if (bleLive || !isValidHeartRateBpm(bpm)) return;

  if (wearConnectFallbackTimer) {
    clearTimeout(wearConnectFallbackTimer);
    wearConnectFallbackTimer = null;
  }
  const now = Date.now();
  const wasWearLive = isWearHrLive(now);
  wearHrLastAt = now;
  if (!wasWearLive) {
    const bridge = getNativeBridge();
    if (bridge && statusState.state === "scanning") {
      try {
        bridge.stopScan();
      } catch {}
    }
  }
  statusState.source = "wear_os";
  statusState.state = "connected";
  statusState.errorCode = "";
  statusState.batteryPct = null;
  statusState.contactDetected = true;
  statusState.deviceId = `wear:${String(payload.nodeId || "watch")}`;
  if (wearName) statusState.deviceName = wearName;
  if (sessionTracker.recordSample(bpm, true, now)) {
    sessionTracker.syncCompanionSummary(
      typeof payload.avgBpm === "number" ? payload.avgBpm : undefined,
      typeof payload.maxBpm === "number" ? payload.maxBpm : undefined
    );
    armStaleSampleWatchdog();
  }
  armWearHrTimeout();
  emitStatus();
}

function armStaleSampleWatchdog(): void {
  if (typeof window === "undefined") return;
  if (staleSampleWatchdogTimer) {
    clearTimeout(staleSampleWatchdogTimer);
    staleSampleWatchdogTimer = null;
  }
  if (statusState.state !== "connected") return;
  const timeoutMs = statusState.source === "wear_os" ? WEAR_HR_LIVE_WINDOW_MS : 12_500;
  staleSampleWatchdogTimer = setTimeout(() => {
    staleSampleWatchdogTimer = null;
    sessionTracker.clearCurrentReading();
    emitStatus();
  }, timeoutMs);
}

function getNativeBridge(): NativeBleBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { ArcheryBleHeartRateBridge?: NativeBleBridge })
    .ArcheryBleHeartRateBridge;
  if (bridge && typeof bridge.startScan === "function") {
    return bridge;
  }
  return null;
}

function hasWebBluetooth(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as unknown as { bluetooth?: { requestDevice?: unknown } };
  return Boolean(nav.bluetooth && typeof nav.bluetooth.requestDevice === "function");
}

function detectTransport(): "native_android" | "web_bluetooth" | "unsupported" {
  if (getNativeBridge()) return "native_android";
  if (hasWebBluetooth()) return "web_bluetooth";
  return "unsupported";
}

function persistSavedSensorMeta(id: string, name: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!id && !name) {
      localStorage.removeItem(STORAGE_KEY_SAVED_SENSOR);
      return;
    }
    localStorage.setItem(
      STORAGE_KEY_SAVED_SENSOR,
      JSON.stringify({ id, name, savedAt: Date.now() })
    );
  } catch {}
}

export function getSavedBleSensorMeta(): { id: string; name: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SAVED_SENSOR);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (typeof parsed.id === "string" || typeof parsed.name === "string")) {
      return { id: String(parsed.id || ""), name: String(parsed.name || "") };
    }
  } catch {}
  return null;
}

function getActiveStaleWindowMs(): number {
  return statusState.source === "wear_os" ? WEAR_HR_LIVE_WINDOW_MS : 12_000;
}

function emitStatus(): void {
  const trackerSnap = sessionTracker.getSnapshot(Date.now(), getActiveStaleWindowMs());
  const transport = detectTransport();
  statusState = {
    ...statusState,
    transport,
    supported: transport !== "unsupported",
    currentBpm:
      statusState.state === "connected" ? trackerSnap.currentBpm : 0,
    avgHeartRateBpm: trackerSnap.avgHeartRateBpm,
    maxHeartRateBpm: trackerSnap.maxHeartRateBpm,
    lastSampleAt: trackerSnap.lastSampleAt
  };
  const snapshot = {
    ...statusState,
    discoveredDevices: [...statusState.discoveredDevices]
  };
  listeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {}
  });
}

function applyNativePayload(payload: any): void {
  if (!payload || typeof payload !== "object") return;

  if (Array.isArray(payload.devices)) {
    statusState.discoveredDevices = payload.devices
      .filter((d: any) => d && typeof d.id === "string")
      .map((d: any) => ({
        id: String(d.id),
        name: String(d.name || "Sensor Bluetooth"),
        rssi: typeof d.rssi === "number" ? d.rssi : undefined,
        hasHrService: Boolean(d.hasHrService),
        isBondedOrConnected: Boolean(d.isBondedOrConnected)
      }));
  }

  // While the watch app is streaming (or connecting) live pulse, BLE scan/idle/error transitions
  // must never overwrite it. Only a genuinely connected BLE sensor may take over.
  const wearPending =
    statusState.source === "wear_os" &&
    statusState.state === "connecting" &&
    wearConnectFallbackTimer !== null;
  if ((isWearHrLive() || wearPending) && payload.state !== "connected") {
    emitStatus();
    return;
  }
  if (payload.state === "connected") {
    statusState.source = "ble";
  }

  if (typeof payload.state === "string") {
    statusState.state = payload.state as BleHrConnectionState;
    if (payload.state !== "connected") {
      sessionTracker.clearCurrentReading();
    }
  }
  if (typeof payload.deviceId === "string") {
    statusState.deviceId = payload.deviceId;
  }
  if (typeof payload.deviceName === "string" && payload.deviceName.trim()) {
    statusState.deviceName = payload.deviceName.trim();
  }
  if (statusState.state === "connected" && statusState.source === "ble" && (statusState.deviceId || statusState.deviceName)) {
    persistSavedSensorMeta(statusState.deviceId, statusState.deviceName);
  }
  if (typeof payload.batteryPct === "number" && payload.batteryPct >= 0 && payload.batteryPct <= 100) {
    statusState.batteryPct = Math.round(payload.batteryPct);
  } else if (payload.batteryPct === null) {
    statusState.batteryPct = null;
  }
  if (typeof payload.errorCode === "string") {
    statusState.errorCode = payload.errorCode;
  }
  if (typeof payload.contactDetected === "boolean" || payload.contactDetected === null) {
    statusState.contactDetected = payload.contactDetected;
  }

  if (Array.isArray(payload.rawBytes) && payload.rawBytes.length >= 2) {
    const parsed = parseHeartRateMeasurement(Uint8Array.from(payload.rawBytes));
    if (parsed) {
      statusState.contactDetected = parsed.contactDetected;
      if (sessionTracker.recordSample(parsed.bpm, parsed.contactDetected, Date.now())) {
        armStaleSampleWatchdog();
      }
    }
  } else if (typeof payload.bpm === "number" && payload.bpm > 0) {
    if (
      sessionTracker.recordSample(
        payload.bpm,
        typeof payload.contactDetected === "boolean" ? payload.contactDetected : null,
        Date.now()
      )
    ) {
      armStaleSampleWatchdog();
    }
  }

  emitStatus();
}

function ensureInitialized(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const saved = getSavedBleSensorMeta();
  if (saved) {
    statusState.deviceId = saved.id;
    statusState.deviceName = saved.name;
  }

  const win = window as unknown as {
    __onNativeBleHrUpdate?: (data: unknown) => void;
    __onNativeBleHrDevices?: (devices: unknown) => void;
    __onNativeWearHrUpdate?: (data: unknown) => void;
  };

  win.__onNativeWearHrUpdate = (data: unknown) => {
    try {
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      applyWearPayload(parsed);
    } catch {}
  };

  win.__onNativeBleHrUpdate = (data: unknown) => {
    try {
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      applyNativePayload(parsed);
    } catch {}
  };

  win.__onNativeBleHrDevices = (devices: unknown) => {
    try {
      const arr = typeof devices === "string" ? JSON.parse(devices) : devices;
      if (Array.isArray(arr)) {
        applyNativePayload({ devices: arr });
      }
    } catch {}
  };

  const bridge = getNativeBridge();
  if (bridge && typeof bridge.getStatusJson === "function") {
    try {
      const initialRaw = bridge.getStatusJson();
      if (initialRaw) {
        applyNativePayload(JSON.parse(initialRaw));
      }
    } catch {}
    if (typeof bridge.getLastWearHeartRateJson === "function") {
      try {
        const cachedWear = bridge.getLastWearHeartRateJson();
        if (cachedWear) {
          applyWearPayload(JSON.parse(cachedWear));
        }
      } catch {}
    }
  } else {
    emitStatus();
  }
}

export function getBleHeartRateStatus(): BleHeartRateStatus {
  ensureInitialized();
  const transport = detectTransport();
  const trackerSnap = sessionTracker.getSnapshot(Date.now(), getActiveStaleWindowMs());
  return {
    ...statusState,
    transport,
    supported: transport !== "unsupported",
    currentBpm: statusState.state === "connected" ? trackerSnap.currentBpm : 0,
    discoveredDevices: [...statusState.discoveredDevices]
  };
}

export function subscribeBleHeartRate(
  callback: (status: BleHeartRateStatus) => void
): () => void {
  ensureInitialized();
  listeners.add(callback);
  callback(getBleHeartRateStatus());
  return () => {
    listeners.delete(callback);
  };
}

export function resetBleHeartRateSessionStats(
  seedAvgBpm = 0,
  seedMaxBpm = 0,
  seedSampleCount = 1
): void {
  const now = Date.now();
  const liveBeforeReset =
    statusState.state === "connected"
      ? sessionTracker.getSnapshot(now, getActiveStaleWindowMs()).currentBpm
      : 0;
  sessionTracker.resetSessionStats(seedAvgBpm, seedMaxBpm, seedSampleCount);
  if (!isValidHeartRateBpm(seedAvgBpm) && isValidHeartRateBpm(liveBeforeReset)) {
    sessionTracker.recordSample(liveBeforeReset, statusState.contactDetected, now);
  }
  emitStatus();
}

export function tryAutoReconnectBleHeartRate(): void {
  ensureInitialized();
  requestWatchAppHeartRate();
  const bridge = getNativeBridge();
  if (bridge && typeof bridge.tryAutoReconnectSaved === "function") {
    try {
      bridge.tryAutoReconnectSaved();
    } catch {}
  }
}

async function connectWebBluetoothGatt(device: any): Promise<void> {
  if (!device || !device.gatt) {
    throw new Error("GATT_UNAVAILABLE");
  }

  statusState.state = "connecting";
  statusState.errorCode = "";
  statusState.batteryPct = null;
  statusState.deviceId = String(device.id || "web-ble");
  statusState.deviceName = String(device.name || "Sensor Bluetooth");
  emitStatus();

  const server = await device.gatt.connect();
  const hrService = await server.getPrimaryService(BLE_HR_SERVICE_UUID);
  const hrChar = await hrService.getCharacteristic(BLE_HR_MEASUREMENT_CHAR_UUID);

  if (webBleHrChar && webBleHrChar !== hrChar) {
    try {
      webBleHrChar.removeEventListener("characteristicvaluechanged", onWebCharValueChanged);
    } catch {}
  }

  webBleHrChar = hrChar;
  hrChar.addEventListener("characteristicvaluechanged", onWebCharValueChanged);
  await hrChar.startNotifications();

  // Optional standard Battery Service (0x180F -> 0x2A19)
  try {
    const battService = await server.getPrimaryService(BLE_BATTERY_SERVICE_UUID);
    const battChar = await battService.getCharacteristic(BLE_BATTERY_LEVEL_CHAR_UUID);
    const battVal = await battChar.readValue();
    if (battVal && battVal.byteLength >= 1) {
      const pct = battVal.getUint8(0);
      if (pct >= 0 && pct <= 100) {
        statusState.batteryPct = pct;
      }
    }
  } catch {
    // Many fitness bands omit Battery Service on HR Broadcast; safe to ignore
  }

  statusState.state = "connected";
  statusState.errorCode = "";
  persistSavedSensorMeta(statusState.deviceId, statusState.deviceName);
  emitStatus();
}

function onWebCharValueChanged(event: any): void {
  try {
    const dv: DataView | undefined = event?.target?.value;
    if (!dv) return;
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    const parsed = parseHeartRateMeasurement(bytes);
    if (!parsed) return;
    statusState.contactDetected = parsed.contactDetected;
    if (sessionTracker.recordSample(parsed.bpm, parsed.contactDetected, Date.now())) {
      armStaleSampleWatchdog();
    }
    emitStatus();
  } catch {}
}

function onWebGattDisconnected(): void {
  sessionTracker.clearCurrentReading();
  statusState.batteryPct = null;
  if (webUserDisconnected || !webBleDevice) {
    statusState.state = "disconnected";
    emitStatus();
    return;
  }

  statusState.state = "reconnecting";
  emitStatus();

  if (webReconnectTimer) clearTimeout(webReconnectTimer);
  webReconnectTimer = setTimeout(async () => {
    if (webUserDisconnected || !webBleDevice) return;
    try {
      await connectWebBluetoothGatt(webBleDevice);
    } catch {
      statusState.state = "disconnected";
      emitStatus();
    }
  }, 1800);
}

/**
 * Starts BLE discovery:
 * - On Native Android APK: triggers native BluetoothLeScanner + connected/bonded GATT inspection
 *   and populates `status.discoveredDevices` directly inside our matte-OLED modal.
 * - On Web Bluetooth browsers (Chrome Android / Desktop): opens the browser's native `0x180D` picker
 *   and connects immediately upon selection.
 */
export async function startBleHeartRateScanOrRequest(): Promise<void> {
  ensureInitialized();
  wearHrMuted = false;
  if (isWearHrLive()) {
    // Live pulse is already flowing from the watch app; nothing to scan for.
    emitStatus();
    return;
  }
  statusState.errorCode = "";

  const bridge = getNativeBridge();
  if (bridge) {
    requestWatchAppHeartRate();
    const now = Date.now();
    if (statusState.state === "scanning" && now - lastNativeScanStartedAt < 2500) {
      return;
    }
    lastNativeScanStartedAt = now;
    statusState.state = "scanning";
    emitStatus();
    try {
      bridge.startScan();
    } catch {
      statusState.state = "error";
      statusState.errorCode = "NATIVE_SCAN_FAILED";
      emitStatus();
    }
    return;
  }

  if (!hasWebBluetooth()) {
    statusState.state = "unsupported";
    statusState.errorCode = "BLE_UNSUPPORTED";
    emitStatus();
    return;
  }

  try {
    webUserDisconnected = false;
    statusState.state = "scanning";
    emitStatus();

    const navBle = (navigator as unknown as { bluetooth: any }).bluetooth;
    const device = await navBle.requestDevice({
      filters: [{ services: [BLE_HR_SERVICE_UUID] }],
      optionalServices: [BLE_BATTERY_SERVICE_UUID]
    });

    if (webBleDevice && webBleDevice !== device) {
      try {
        webBleDevice.removeEventListener("gattserverdisconnected", onWebGattDisconnected);
        if (webBleDevice.gatt?.connected) webBleDevice.gatt.disconnect();
      } catch {}
    }

    webBleDevice = device;
    device.addEventListener("gattserverdisconnected", onWebGattDisconnected);
    await connectWebBluetoothGatt(device);
  } catch (err: any) {
    const name = String(err?.name || "");
    const msg = String(err?.message || "");
    if (name === "NotFoundError" || msg.toLowerCase().includes("cancelled") || msg.toLowerCase().includes("canceled")) {
      // User dismissed picker without selecting a device
      statusState.state = "disconnected";
      statusState.errorCode = "";
      emitStatus();
      return;
    }
    statusState.state = "error";
    statusState.errorCode = name === "SecurityError" ? "PERMISSION_DENIED" : "CONNECT_FAILED";
    emitStatus();
  }
}

export function stopBleHeartRateScan(): void {
  ensureInitialized();
  const bridge = getNativeBridge();
  if (bridge) {
    try {
      bridge.stopScan();
    } catch {}
  }
  if (statusState.state === "scanning") {
    statusState.state = "disconnected";
    emitStatus();
  }
}

/** Asks the ARCHERY 101010 watch app (via Bluetooth Data Layer & 6-Digit Cloud) to stream live pulse. */
export function requestWatchAppHeartRate(options?: { unmute?: boolean }): void {
  ensureInitialized();
  const shouldUnmute = options?.unmute !== false;
  if (shouldUnmute) {
    wearHrMuted = false;
  } else if (wearHrMuted) {
    return;
  }
  const bridge = getNativeBridge();
  if (bridge && typeof bridge.requestWatchHeartRate === "function") {
    try {
      bridge.requestWatchHeartRate();
    } catch {}
  }
  if (bridge && typeof bridge.getLastWearHeartRateJson === "function") {
    try {
      const cachedWear = bridge.getLastWearHeartRateJson();
      if (cachedWear) {
        applyWearPayload(JSON.parse(cachedWear));
      }
    } catch {}
  }
  if (typeof window !== "undefined") {
    try {
      (window as unknown as { __requestCloudWatchHeartRate?: () => void }).__requestCloudWatchHeartRate?.();
    } catch {}
  }
}

export function connectBleHeartRateDevice(deviceId: string, deviceName?: string): void {
  ensureInitialized();
  const bridge = getNativeBridge();
  if (!bridge) return;

  const target = statusState.discoveredDevices.find((d) => d.id === deviceId);
  if (isLikelyCompanionSmartwatch(target)) {
    // Paired smartwatches stream live pulse through the ARCHERY 101010 watch app (Wear Data Layer / 6-digit Cloud).
    wearHrMuted = false;
    try {
      bridge.stopScan();
    } catch {}
    requestWatchAppHeartRate();
    if (isWearHrLive()) {
      emitStatus();
      return;
    }
    if (wearConnectFallbackTimer) {
      clearTimeout(wearConnectFallbackTimer);
      wearConnectFallbackTimer = null;
    }
    statusState.source = "wear_os";
    statusState.state = "connecting";
    statusState.errorCode = "";
    statusState.deviceId = deviceId;
    if (deviceName) statusState.deviceName = deviceName;
    wearConnectFallbackTimer = setTimeout(() => {
      wearConnectFallbackTimer = null;
      if (!isWearHrLive() && statusState.source === "wear_os" && statusState.state !== "connected") {
        statusState.state = "disconnected";
        statusState.errorCode = "WEAR_APP_REQUIRED";
        emitStatus();
      }
    }, 4_500);
    emitStatus();
    return;
  }

  statusState.source = "ble";
  statusState.state = "connecting";
  statusState.errorCode = "";
  statusState.batteryPct = null;
  statusState.deviceId = deviceId;
  if (deviceName) statusState.deviceName = deviceName;
  emitStatus();
  try {
    bridge.connectDevice(deviceId, deviceName || "");
  } catch {
    statusState.state = "error";
    statusState.errorCode = "CONNECT_FAILED";
    emitStatus();
  }
}

export function disconnectBleHeartRateDevice(forgetSaved = false): void {
  ensureInitialized();
  webUserDisconnected = true;
  if (webReconnectTimer) {
    clearTimeout(webReconnectTimer);
    webReconnectTimer = null;
  }
  if (wearConnectFallbackTimer) {
    clearTimeout(wearConnectFallbackTimer);
    wearConnectFallbackTimer = null;
  }
  if (statusState.source === "wear_os") {
    wearHrMuted = true;
    wearHrLastAt = 0;
    statusState.source = "ble";
  }
  if (wearHrTimeoutTimer) {
    clearTimeout(wearHrTimeoutTimer);
    wearHrTimeoutTimer = null;
  }
  if (staleSampleWatchdogTimer) {
    clearTimeout(staleSampleWatchdogTimer);
    staleSampleWatchdogTimer = null;
  }

  const bridge = getNativeBridge();
  if (bridge) {
    try {
      bridge.disconnectDevice(Boolean(forgetSaved));
    } catch {}
  }

  if (webBleHrChar) {
    try {
      webBleHrChar.removeEventListener("characteristicvaluechanged", onWebCharValueChanged);
      webBleHrChar.stopNotifications?.();
    } catch {}
    webBleHrChar = null;
  }

  if (webBleDevice) {
    try {
      webBleDevice.removeEventListener("gattserverdisconnected", onWebGattDisconnected);
      if (webBleDevice.gatt?.connected) {
        webBleDevice.gatt.disconnect();
      }
    } catch {}
    webBleDevice = null;
  }

  sessionTracker.clearCurrentReading();
  statusState.state = "disconnected";
  statusState.batteryPct = null;
  statusState.contactDetected = null;
  statusState.errorCode = "";
  if (forgetSaved) {
    statusState.deviceId = "";
    statusState.deviceName = "";
    persistSavedSensorMeta("", "");
  }
  emitStatus();
}

if (typeof window !== "undefined") {
  ensureInitialized();
}
