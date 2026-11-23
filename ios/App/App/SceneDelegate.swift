import UIKit
import Capacitor
import CoreBluetooth
import WatchConnectivity
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ArcheryIosBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Capacitor ViewController that wires CoreBluetooth (0x180D / 0x2A37) + WatchConnectivity
/// directly into WKWebView with the exact same JS contract as Android's ArcheryBleHeartRateBridge.
final class ArcheryIosBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let wv = self.webView else { return }
        ArcheryIosBleHeartRateManager.shared.attach(to: wv)
    }
}

final class ArcheryIosBleHeartRateManager: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate, WCSessionDelegate, WKScriptMessageHandler {
    static let shared = ArcheryIosBleHeartRateManager()

    private let hrServiceUUID = CBUUID(string: "180D")
    private let hrMeasurementUUID = CBUUID(string: "2A37")
    private let batteryServiceUUID = CBUUID(string: "180F")
    private let batteryLevelUUID = CBUUID(string: "2A19")
    private let savedUuidPrefsKey = "archery_ios_ble_saved_uuid"
    private let savedNamePrefsKey = "archery_ios_ble_saved_name"

    private weak var webView: WKWebView?
    private var central: CBCentralManager?
    private var peripheralsById: [String: CBPeripheral] = [:]
    private var discoveredMeta: [String: [String: Any]] = [:]
    private var activePeripheral: CBPeripheral?
    private var scanStopWorkItem: DispatchWorkItem?
    private var userRequestedDisconnect = false
    private var pendingActionAfterPowerOn = 0 // 1 = scan, 2 = connect, 3 = autoReconnect

    private var stateStr: String = "disconnected"
    private var deviceIdStr: String = ""
    private var deviceNameStr: String = ""
    private var errorCodeStr: String = ""
    private var batteryPctVal: Int? = nil

    func attach(to webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "ArcheryIosBleHr")
        ucc.add(self, name: "ArcheryIosBleHr")

        let savedId = UserDefaults.standard.string(forKey: savedUuidPrefsKey) ?? ""
        let savedName = UserDefaults.standard.string(forKey: savedNamePrefsKey) ?? ""
        if deviceIdStr.isEmpty && !savedId.isEmpty {
            deviceIdStr = savedId
            deviceNameStr = savedName
        }

        let initialJson = escapeJs(buildStatusJson(rawBytes: nil))
        let shimJs = """
        (function() {
          if (window.ArcheryBleHeartRateBridge) return;
          window.__archeryIosBleCachedStatus = '\(initialJson)';
          window.ArcheryBleHeartRateBridge = {
            startScan: function() {
              window.webkit.messageHandlers.ArcheryIosBleHr.postMessage({ action: 'startScan' });
            },
            stopScan: function() {
              window.webkit.messageHandlers.ArcheryIosBleHr.postMessage({ action: 'stopScan' });
            },
            connectDevice: function(address, name) {
              window.webkit.messageHandlers.ArcheryIosBleHr.postMessage({ action: 'connectDevice', address: address || '', name: name || '' });
            },
            disconnectDevice: function(forget) {
              window.webkit.messageHandlers.ArcheryIosBleHr.postMessage({ action: 'disconnectDevice', forget: !!forget });
            },
            tryAutoReconnectSaved: function() {
              window.webkit.messageHandlers.ArcheryIosBleHr.postMessage({ action: 'tryAutoReconnectSaved' });
            },
            requestWatchHeartRate: function() {
              window.webkit.messageHandlers.ArcheryIosBleHr.postMessage({ action: 'requestWatchHeartRate' });
            },
            getStatusJson: function() {
              return window.__archeryIosBleCachedStatus || '{"state":"disconnected"}';
            }
          };
        })();
        """
        ucc.addUserScript(WKUserScript(source: shimJs, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.evaluateJavaScript(shimJs, completionHandler: nil)

        if WCSession.isSupported() {
            let session = WCSession.default
            if session.delegate == nil {
                session.delegate = self
                session.activate()
            }
        }
    }

    private func ensureCentral() -> CBCentralManager {
        if let existing = central { return existing }
        let mgr = CBCentralManager(delegate: self, queue: .main)
        central = mgr
        return mgr
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "startScan":
            startScanInternal()
        case "stopScan":
            stopScanInternal()
        case "connectDevice":
            let addr = (body["address"] as? String) ?? ""
            let name = (body["name"] as? String) ?? ""
            connectDeviceInternal(uuidStr: addr, name: name)
        case "disconnectDevice":
            let forget = (body["forget"] as? Bool) ?? false
            disconnectInternal(forgetSaved: forget)
        case "tryAutoReconnectSaved":
            tryAutoReconnectInternal()
        case "requestWatchHeartRate":
            requestWatchHeartRateInternal()
        default:
            break
        }
    }

    private func requestWatchHeartRateInternal() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.activationState != .activated {
            session.activate()
            return
        }
        guard session.isReachable else { return }
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        session.sendMessage(["type": "HR_REQUEST", "_ts": nowMs], replyHandler: nil, errorHandler: nil)
    }

    private func startScanInternal() {
        requestWatchHeartRateInternal()
        let mgr = ensureCentral()
        switch mgr.state {
        case .poweredOn:
            pendingActionAfterPowerOn = 0
        case .unauthorized:
            stateStr = "error"
            errorCodeStr = "PERMISSION_DENIED"
            emitStatus(rawBytes: nil)
            return
        case .poweredOff:
            stateStr = "error"
            errorCodeStr = "BLUETOOTH_OFF"
            emitStatus(rawBytes: nil)
            return
        case .unsupported:
            stateStr = "unsupported"
            errorCodeStr = "BLE_UNSUPPORTED"
            emitStatus(rawBytes: nil)
            return
        default:
            pendingActionAfterPowerOn = 1
            return
        }

        stopScanInternal()
        discoveredMeta.removeAll()

        // Include already-connected system BLE heart-rate peripherals (e.g. biometric bands paired to iOS)
        let connected = mgr.retrieveConnectedPeripherals(withServices: [hrServiceUUID])
        for p in connected {
            let id = p.identifier.uuidString
            let cleanName = (p.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            peripheralsById[id] = p
            discoveredMeta[id] = [
                "id": id,
                "name": cleanName.isEmpty ? "Sensor Bluetooth" : cleanName,
                "rssi": -42,
                "hasHrService": true,
                "isBondedOrConnected": true
            ]
        }

        errorCodeStr = ""
        if stateStr != "connected" {
            stateStr = "scanning"
        }
        emitStatus(rawBytes: nil)
        mgr.scanForPeripherals(withServices: [hrServiceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])

        let stopWork = DispatchWorkItem { [weak self] in
            self?.stopScanInternal()
        }
        scanStopWorkItem = stopWork
        DispatchQueue.main.asyncAfter(deadline: .now() + 12.0, execute: stopWork)
    }

    private func stopScanInternal() {
        scanStopWorkItem?.cancel()
        scanStopWorkItem = nil
        if let mgr = central, mgr.state == .poweredOn, mgr.isScanning {
            mgr.stopScan()
        }
        if stateStr == "scanning" {
            stateStr = (activePeripheral?.state == .connected) ? "connected" : "disconnected"
            emitStatus(rawBytes: nil)
        }
    }

    private func connectDeviceInternal(uuidStr: String, name: String) {
        guard !uuidStr.isEmpty else { return }
        userRequestedDisconnect = false
        deviceIdStr = uuidStr
        if !name.isEmpty { deviceNameStr = name }
        errorCodeStr = ""
        batteryPctVal = nil

        let mgr = ensureCentral()
        guard mgr.state == .poweredOn else {
            pendingActionAfterPowerOn = 2
            return
        }

        stopScanInternal()
        if let old = activePeripheral, old.identifier.uuidString != uuidStr {
            mgr.cancelPeripheralConnection(old)
            activePeripheral = nil
        }

        var target = peripheralsById[uuidStr]
        if target == nil, let uuid = UUID(uuidString: uuidStr) {
            target = mgr.retrievePeripherals(withIdentifiers: [uuid]).first
            if let found = target {
                peripheralsById[uuidStr] = found
            }
        }
        guard let peripheral = target else {
            stateStr = "error"
            errorCodeStr = "CONNECT_FAILED"
            emitStatus(rawBytes: nil)
            return
        }

        activePeripheral = peripheral
        peripheral.delegate = self
        stateStr = "connecting"
        emitStatus(rawBytes: nil)
        mgr.connect(peripheral, options: nil)
    }

    private func tryAutoReconnectInternal() {
        guard stateStr != "connected" && stateStr != "connecting" else { return }
        let savedId = UserDefaults.standard.string(forKey: savedUuidPrefsKey) ?? ""
        let savedName = UserDefaults.standard.string(forKey: savedNamePrefsKey) ?? ""
        guard !savedId.isEmpty else { return }
        let mgr = ensureCentral()
        guard mgr.state == .poweredOn else {
            pendingActionAfterPowerOn = 3
            return
        }
        connectDeviceInternal(uuidStr: savedId, name: savedName)
    }

    private func disconnectInternal(forgetSaved: Bool) {
        userRequestedDisconnect = true
        stopScanInternal()
        if let mgr = central, let p = activePeripheral {
            mgr.cancelPeripheralConnection(p)
        }
        activePeripheral = nil
        batteryPctVal = nil
        errorCodeStr = ""
        stateStr = "disconnected"
        if forgetSaved {
            deviceIdStr = ""
            deviceNameStr = ""
            UserDefaults.standard.removeObject(forKey: savedUuidPrefsKey)
            UserDefaults.standard.removeObject(forKey: savedNamePrefsKey)
        }
        emitStatus(rawBytes: nil)
    }

    // MARK: - CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            let pending = pendingActionAfterPowerOn
            pendingActionAfterPowerOn = 0
            if pending == 1 {
                startScanInternal()
            } else if pending == 2 {
                connectDeviceInternal(uuidStr: deviceIdStr, name: deviceNameStr)
            } else if pending == 3 {
                tryAutoReconnectInternal()
            }
        } else if central.state == .poweredOff {
            stateStr = "error"
            errorCodeStr = "BLUETOOTH_OFF"
            emitStatus(rawBytes: nil)
        } else if central.state == .unauthorized {
            stateStr = "error"
            errorCodeStr = "PERMISSION_DENIED"
            emitStatus(rawBytes: nil)
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let id = peripheral.identifier.uuidString
        peripheralsById[id] = peripheral
        let advName = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? ""
        let rawName = !(peripheral.name ?? "").isEmpty ? (peripheral.name ?? "") : advName
        let cleanName = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        discoveredMeta[id] = [
            "id": id,
            "name": cleanName.isEmpty ? "Sensor Bluetooth" : cleanName,
            "rssi": RSSI.intValue,
            "hasHrService": true,
            "isBondedOrConnected": false
        ]
        emitDevicesOnly()
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral == activePeripheral else { return }
        if let name = peripheral.name, !name.isEmpty {
            deviceNameStr = name
        }
        UserDefaults.standard.set(peripheral.identifier.uuidString, forKey: savedUuidPrefsKey)
        UserDefaults.standard.set(deviceNameStr, forKey: savedNamePrefsKey)
        peripheral.delegate = self
        peripheral.discoverServices([hrServiceUUID, batteryServiceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard peripheral == activePeripheral else { return }
        activePeripheral = nil
        stateStr = "error"
        errorCodeStr = "CONNECT_FAILED"
        emitStatus(rawBytes: nil)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard peripheral == activePeripheral else { return }
        batteryPctVal = nil
        if !userRequestedDisconnect {
            stateStr = "reconnecting"
            emitStatus(rawBytes: nil)
            central.connect(peripheral, options: nil)
        } else {
            activePeripheral = nil
            stateStr = "disconnected"
            emitStatus(rawBytes: nil)
        }
    }

    // MARK: - CBPeripheralDelegate

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral == activePeripheral, let services = peripheral.services else { return }
        var foundHr = false
        for svc in services {
            if svc.uuid == hrServiceUUID {
                foundHr = true
                peripheral.discoverCharacteristics([hrMeasurementUUID], for: svc)
            } else if svc.uuid == batteryServiceUUID {
                peripheral.discoverCharacteristics([batteryLevelUUID], for: svc)
            }
        }
        if !foundHr {
            stateStr = "error"
            errorCodeStr = "HR_BROADCAST_NOT_ENABLED"
            central?.cancelPeripheralConnection(peripheral)
            activePeripheral = nil
            emitStatus(rawBytes: nil)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard peripheral == activePeripheral, let chars = service.characteristics else { return }
        for ch in chars {
            if ch.uuid == hrMeasurementUUID {
                peripheral.setNotifyValue(true, for: ch)
                stateStr = "connected"
                errorCodeStr = ""
                emitStatus(rawBytes: nil)
            } else if ch.uuid == batteryLevelUUID {
                peripheral.readValue(for: ch)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral == activePeripheral, error == nil, let data = characteristic.value else { return }
        if characteristic.uuid == hrMeasurementUUID {
            if stateStr != "connected" {
                stateStr = "connected"
                errorCodeStr = ""
            }
            emitStatus(rawBytes: [UInt8](data))
        } else if characteristic.uuid == batteryLevelUUID, let first = data.first {
            let pct = Int(first)
            if pct >= 0 && pct <= 100 {
                batteryPctVal = pct
                emitStatus(rawBytes: nil)
            }
        }
    }

    // MARK: - WCSessionDelegate (Live Pulse from Paired Watch)

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        forwardWatchHrIfPresent(message)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        forwardWatchHrIfPresent(message)
        replyHandler(["type": "PONG", "_ts": Int64(Date().timeIntervalSince1970 * 1000)])
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        forwardWatchHrIfPresent(userInfo)
    }

    private func forwardWatchHrIfPresent(_ dict: [String: Any]) {
        let msgType = (dict["type"] as? String) ?? ""
        if msgType == "HR" {
            emitWearHr(
                bpm: (dict["bpm"] as? Int) ?? 0,
                status: (dict["status"] as? String) ?? "ok",
                name: (dict["deviceName"] as? String) ?? "Smartwatch Deportivo"
            )
            return
        }
        if let hr = dict["heartRateBpm"] as? Int, hr >= 30 {
            emitWearHr(bpm: hr, status: "ok", name: "Smartwatch Deportivo")
        }
    }

    private func emitWearHr(bpm: Int, status: String, name: String) {
        let out: [String: Any] = [
            "bpm": bpm,
            "status": status,
            "deviceName": name,
            "nodeId": "watchos-companion"
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: out, options: []),
              let jsonStr = String(data: data, encoding: .utf8) else { return }
        let escaped = escapeJs(jsonStr)
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "if (window.__onNativeWearHrUpdate) { window.__onNativeWearHrUpdate('\(escaped)'); }",
                completionHandler: nil
            )
        }
    }

    // MARK: - JSON Serialization & WebView Emission

    private func buildDevicesArray() -> [[String: Any]] {
        return Array(discoveredMeta.values)
    }

    private func buildStatusJson(rawBytes: [UInt8]?) -> String {
        var obj: [String: Any] = [
            "state": stateStr,
            "deviceId": deviceIdStr,
            "deviceName": deviceNameStr,
            "errorCode": errorCodeStr,
            "batteryPct": batteryPctVal as Any
        ]
        if batteryPctVal == nil {
            obj["batteryPct"] = NSNull()
        }
        if let bytes = rawBytes, bytes.count >= 2 {
            obj["rawBytes"] = bytes.map { Int($0) }
        } else {
            obj["devices"] = buildDevicesArray()
        }
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
              let str = String(data: data, encoding: .utf8) else {
            return "{\"state\":\"disconnected\"}"
        }
        return str
    }

    private func emitStatus(rawBytes: [UInt8]?) {
        let jsonStr = buildStatusJson(rawBytes: rawBytes)
        let escaped = escapeJs(jsonStr)
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "window.__archeryIosBleCachedStatus = '\(escaped)'; if (window.__onNativeBleHrUpdate) { window.__onNativeBleHrUpdate('\(escaped)'); }",
                completionHandler: nil
            )
        }
    }

    private func emitDevicesOnly() {
        guard let data = try? JSONSerialization.data(withJSONObject: buildDevicesArray(), options: []),
              let jsonStr = String(data: data, encoding: .utf8) else { return }
        let escaped = escapeJs(jsonStr)
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "if (window.__onNativeBleHrDevices) { window.__onNativeBleHrDevices('\(escaped)'); }",
                completionHandler: nil
            )
        }
    }

    private func escapeJs(_ raw: String) -> String {
        return raw
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
    }
}
