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

export interface BleHeartRateStatus {
  transport: "native_android" | "web_bluetooth" | "unsupported";
  supported: boolean;
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

  resetSessionStats(seedAvgBpm = 0, seedMaxBpm = 0): void {
    const cleanAvg = isValidHeartRateBpm(seedAvgBpm) ? Math.round(seedAvgBpm) : 0;
    const cleanMax = isValidHeartRateBpm(seedMaxBpm)
      ? Math.max(cleanAvg, Math.round(seedMaxBpm))
      : cleanAvg;
    this.sumBpm = cleanAvg > 0 ? cleanAvg : 0;
    this.sampleCount = cleanAvg > 0 ? 1 : 0;
    this.avgBpmVal = cleanAvg;
    this.maxBpmVal = cleanMax;
  }

  clearCurrentReading(): void {
    this.currentBpmVal = 0;
  }

  getSnapshot() {
    return {
      currentBpm: this.currentBpmVal,
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
}

const sessionTracker = new BleHeartRateSessionTracker();
const listeners = new Set<(status: BleHeartRateStatus) => void>();

let statusState: BleHeartRateStatus = {
  transport: "unsupported",
  supported: false,
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

function emitStatus(): void {
  const trackerSnap = sessionTracker.getSnapshot();
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
  if (statusState.state === "connected" && (statusState.deviceId || statusState.deviceName)) {
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
      sessionTracker.recordSample(parsed.bpm, parsed.contactDetected, Date.now());
    }
  } else if (typeof payload.bpm === "number" && payload.bpm > 0) {
    sessionTracker.recordSample(
      payload.bpm,
      typeof payload.contactDetected === "boolean" ? payload.contactDetected : null,
      Date.now()
    );
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
  } else {
    emitStatus();
  }
}

export function getBleHeartRateStatus(): BleHeartRateStatus {
  ensureInitialized();
  const transport = detectTransport();
  return {
    ...statusState,
    transport,
    supported: transport !== "unsupported",
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

export function resetBleHeartRateSessionStats(seedAvgBpm = 0, seedMaxBpm = 0): void {
  sessionTracker.resetSessionStats(seedAvgBpm, seedMaxBpm);
  emitStatus();
}

export function tryAutoReconnectBleHeartRate(): void {
  ensureInitialized();
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
    sessionTracker.recordSample(parsed.bpm, parsed.contactDetected, Date.now());
    emitStatus();
  } catch {}
}

function onWebGattDisconnected(): void {
  sessionTracker.clearCurrentReading();
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
  statusState.errorCode = "";

  const bridge = getNativeBridge();
  if (bridge) {
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

export function connectBleHeartRateDevice(deviceId: string, deviceName?: string): void {
  ensureInitialized();
  const bridge = getNativeBridge();
  if (!bridge) return;
  statusState.state = "connecting";
  statusState.errorCode = "";
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
