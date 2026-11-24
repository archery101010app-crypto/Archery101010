import Foundation
import WatchConnectivity
import WebKit
#if canImport(UIKit)
import UIKit
#endif

/// Native iOS WatchConnectivity Bridge for ARCHERY 101010.
/// Sole `WCSessionDelegate` on iOS, connecting Capacitor / `WKWebView`
/// (`ArcheryWatchNativeBridge` & `ArcheryNativeWatch`) to the companion sports smartwatch
/// while forwarding live heart-rate updates to `ArcheryIosBleHeartRateManager`.
@objc(ArcheryWatchSessionManager)
public final class ArcheryWatchSessionManager: NSObject, WCSessionDelegate, WKScriptMessageHandler {
    public static let shared = ArcheryWatchSessionManager()

    public weak var webView: WKWebView?
    public var onWatchHeartRateReceived: (([String: Any]) -> Void)?

    private let prefsKey = "archery_101010_last_watch_snapshot"
    private let pendingQueueKey = "archery_101010_pending_watch_cmds_v2"
    private let seenCmdIdsKey = "archery_101010_seen_watch_cmd_ids"
    private let ackSeqKey = "archery_101010_last_ack_watch_seq"
    private let maxWatchCommandAgeMs: Int64 = 15 * 60 * 1000 // 15 minutes TTL
    private let maxSeenCmdIdsCount = 200
    private let maxPendingQueueCount = 100

    private var lastAckCmdSeq: Int64 = 0
    private var lastPongTimestampMs: Int64 = 0
    private var isWebListenerReady: Bool = false
    private var seenCmdIds: [String] = []
    private var seenCmdIdsLoaded: Bool = false

    private override init() {
        super.init()
        lastAckCmdSeq = Int64(UserDefaults.standard.integer(forKey: ackSeqKey))
    }

    // MARK: - Trusted Origin Validation

    public static func isTrustedOrigin(securityOrigin: WKSecurityOrigin) -> Bool {
        let proto = securityOrigin.`protocol`.lowercased()
        let host = securityOrigin.host.lowercased()
        if (proto == "capacitor" || proto == "ionic") && host == "localhost" {
            return true
        }
        if proto == "https" && (host == "archery101010-c0bb4.web.app" || host == "archery101010-c0bb4.firebaseapp.com") {
            return true
        }
        return false
    }

    public static func isTrustedWebViewURL(_ url: URL?) -> Bool {
        guard let url = url, let scheme = url.scheme?.lowercased() else { return false }
        let host = (url.host ?? "").lowercased()
        if (scheme == "capacitor" || scheme == "ionic") && host == "localhost" {
            return true
        }
        if scheme == "https" && (host == "archery101010-c0bb4.web.app" || host == "archery101010-c0bb4.firebaseapp.com") {
            return true
        }
        return false
    }

    // MARK: - Attachment & Activation

    public func attach(to webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "ArcheryWatchNativeBridge")
        ucc.removeScriptMessageHandler(forName: "ArcheryNativeWatch")
        ucc.add(self, name: "ArcheryWatchNativeBridge")
        ucc.add(self, name: "ArcheryNativeWatch")

        let companionShimJs = """
        (function() {
          var o = String((window.location && window.location.origin) || '').toLowerCase();
          if (o !== 'capacitor://localhost' &&
              o !== 'ionic://localhost' &&
              o !== 'https://archery101010-c0bb4.web.app' &&
              o !== 'https://archery101010-c0bb4.firebaseapp.com') {
            return;
          }
          if (window.ArcheryNativeWatch) return;
          window.ArcheryNativeWatch = {
            installAppOnWatch: function() {
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ArcheryNativeWatch) {
                window.webkit.messageHandlers.ArcheryNativeWatch.postMessage({ action: 'installAppOnWatch' });
                return true;
              }
              return false;
            },
            openCompanionApp: function() {
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ArcheryNativeWatch) {
                window.webkit.messageHandlers.ArcheryNativeWatch.postMessage({ action: 'installAppOnWatch' });
                return true;
              }
              return false;
            }
          };
        })();
        """
        ucc.addUserScript(WKUserScript(source: companionShimJs, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if Self.isTrustedWebViewURL(webView.url) {
            webView.evaluateJavaScript(companionShimJs, completionHandler: nil)
        }

        activateSessionIfSupported()
    }

    public func activate(with webView: WKWebView?) {
        if let wv = webView {
            attach(to: wv)
        } else {
            activateSessionIfSupported()
        }
    }

    private func activateSessionIfSupported() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.delegate !== self {
            session.delegate = self
        }
        if session.activationState != .activated {
            session.activate()
        }
    }

    private func escapeForSingleQuotedJs(_ raw: String) -> String {
        return raw
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    // MARK: - Deduplication Ring Buffer & Timestamp Helpers

    private func ensureSeenCmdIdsLoaded() {
        guard !seenCmdIdsLoaded else { return }
        seenCmdIdsLoaded = true
        seenCmdIds = UserDefaults.standard.stringArray(forKey: seenCmdIdsKey) ?? []
    }

    private func recordAndCheckDuplicateCmdId(_ cmdId: String) -> Bool {
        let trimmed = cmdId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        ensureSeenCmdIdsLoaded()
        if seenCmdIds.contains(trimmed) {
            return true
        }
        seenCmdIds.append(trimmed)
        if seenCmdIds.count > maxSeenCmdIdsCount {
            seenCmdIds.removeFirst(seenCmdIds.count - maxSeenCmdIdsCount)
        }
        UserDefaults.standard.set(seenCmdIds, forKey: seenCmdIdsKey)
        return false
    }

    private func extractInt64(_ val: Any?) -> Int64 {
        if let i64 = val as? Int64 { return i64 }
        if let i = val as? Int { return Int64(i) }
        if let d = val as? Double { return Int64(d) }
        if let num = val as? NSNumber { return num.int64Value }
        if let s = val as? String, let parsed = Int64(s) { return parsed }
        return 0
    }

    private func extractInt(_ val: Any?) -> Int {
        if let i = val as? Int { return i }
        if let i64 = val as? Int64 { return Int(i64) }
        if let d = val as? Double { return Int(round(d)) }
        if let num = val as? NSNumber { return num.intValue }
        if let s = val as? String, let parsed = Int(s) { return parsed }
        return 0
    }

    private func sanitizeWatchDisplayName(_ raw: String?) -> String {
        let clean = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.isEmpty {
            return "Smartwatch Deportivo"
        }
        let lower = clean.lowercased()
        if lower.contains("watch") {
            return "Smartwatch Deportivo"
        }
        return clean
    }

    // MARK: - Outgoing State & Commands from Phone to Watch

    public func syncSnapshotToWatch(jsonString: String) {
        guard !jsonString.isEmpty else { return }
        UserDefaults.standard.set(jsonString, forKey: prefsKey)

        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else {
            session.activate()
            return
        }

        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        var payload: [String: Any] = [
            "type": "STATE_UPDATE",
            "snapshot_json": jsonString,
            "_ackCmdSeq": lastAckCmdSeq,
            "updated_at": nowMs,
            "_ts": nowMs
        ]

        if let data = jsonString.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let inner = (parsed["payload"] as? [String: Any]) ?? parsed
            if let token = (parsed["sessionToken"] as? String) ?? (inner["sessionToken"] as? String), !token.isEmpty {
                payload["sessionToken"] = token
            }
            if let code = (parsed["pairingCode"] as? String) ?? (inner["pairingCode"] as? String), !code.isEmpty {
                payload["pairingCode"] = code
            }
        }

        // 1. Persistent Application Context (wakes watch on wrist raise even if sent while watch was asleep)
        try? session.updateApplicationContext(payload)

        // 2. Real-time interactive message when watch is reachable
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
    }

    public func forwardWatchCommandToWatch(jsonString: String) {
        guard !jsonString.isEmpty else { return }
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else {
            session.activate()
            return
        }

        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        var payload: [String: Any] = [
            "type": "PHONE_COMMAND",
            "command_json": jsonString,
            "updated_at": nowMs,
            "_ts": nowMs
        ]

        if let data = jsonString.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let cmdType = parsed["type"] as? String {
            if cmdType == "STATE_UPDATE" {
                syncSnapshotToWatch(jsonString: jsonString)
                return
            }
            if cmdType == "REQUEST_STATE" {
                if session.isReachable {
                    session.sendMessage(["type": "PING", "_ts": nowMs], replyHandler: { [weak self] reply in
                        self?.lastPongTimestampMs = Int64(Date().timeIntervalSince1970 * 1000)
                        if !reply.isEmpty {
                            self?.handleIncomingWatchDictionary(reply, isRealtime: true)
                        }
                        self?.emitConnectionStatusToWebView()
                    }, errorHandler: nil)
                }
                return
            }
            payload["cmdType"] = cmdType
            if let sens = parsed["sensitivityLevel"] as? Int {
                payload["sensitivityLevel"] = sens
            }
            if let enabled = parsed["enabled"] as? Bool {
                payload["enabled"] = enabled
            }
            let tsVal = extractInt64(parsed["ts"])
            if tsVal > 0 {
                payload["ts"] = tsVal
            }
            let calAt = extractInt64(parsed["calibrateZeroAt"])
            if calAt > 0 {
                payload["calibrateZeroAt"] = calAt
            }
            if let zeroVec = parsed["zeroGravityVec"] as? [Double], zeroVec.count == 3 {
                payload["zeroGravityVec"] = zeroVec
            } else if let zeroNums = parsed["zeroGravityVec"] as? [NSNumber], zeroNums.count == 3 {
                payload["zeroGravityVec"] = zeroNums.map { $0.doubleValue }
            }
            if let shotJson = parsed["analysisShotJson"] as? String, !shotJson.isEmpty {
                payload["analysisShotJson"] = String(shotJson.prefix(3500))
            }
        }

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: { _ in
                if session.activationState == .activated && session.isPaired && session.isWatchAppInstalled {
                    session.transferUserInfo(payload)
                }
            })
        } else if session.isPaired && session.isWatchAppInstalled {
            session.transferUserInfo(payload)
        }
    }

    public func requestWatchHeartRate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.activationState != .activated {
            session.activate()
            return
        }
        guard session.isReachable else { return }
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        session.sendMessage(["type": "HR_REQUEST", "_ts": nowMs], replyHandler: { [weak self] reply in
            if !reply.isEmpty {
                self?.handleIncomingWatchDictionary(reply, isRealtime: true)
            }
        }, errorHandler: nil)
    }

    public func pingWatch() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else {
            session.activate()
            return
        }

        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if session.isReachable {
            session.sendMessage(["type": "PING", "_ts": nowMs], replyHandler: { [weak self] reply in
                self?.lastPongTimestampMs = Int64(Date().timeIntervalSince1970 * 1000)
                if !reply.isEmpty {
                    self?.handleIncomingWatchDictionary(reply, isRealtime: true)
                }
                self?.emitConnectionStatusToWebView()
            }, errorHandler: nil)
        }
        if let saved = UserDefaults.standard.string(forKey: prefsKey), !saved.isEmpty {
            syncSnapshotToWatch(jsonString: saved)
        }
        emitConnectionStatusToWebView()
    }

    public func openCompanionWatchInstaller() {
        #if canImport(UIKit)
        DispatchQueue.main.async {
            let candidateUrls = ["itms-watchs://", "itms-watchs://bridge"]
            func tryOpen(_ idx: Int) {
                if idx >= candidateUrls.count {
                    self.presentWatchInstallGuidanceAlert()
                    return
                }
                guard let url = URL(string: candidateUrls[idx]) else {
                    tryOpen(idx + 1)
                    return
                }
                UIApplication.shared.open(url, options: [:]) { success in
                    if !success {
                        tryOpen(idx + 1)
                    }
                }
            }
            tryOpen(0)
        }
        #endif
    }

    #if canImport(UIKit)
    private func presentWatchInstallGuidanceAlert() {
        let isEs = (Locale.current.languageCode ?? "es").lowercased().hasPrefix("es")
        let title = isEs ? "Instalar en tu Reloj" : "Install on Your Watch"
        let message = isEs
            ? "Abre la aplicación Reloj en tu teléfono, desplázate hasta ARCHERY 101010 en Apps Disponibles y pulsa Instalar. También puedes vincular al instante con el código de 6 dígitos."
            : "Open the Watch companion app on your phone, scroll to ARCHERY 101010 under Available Apps, and tap Install. You can also link instantly using the 6-digit code."
        let okTitle = isEs ? "Entendido" : "Got it"

        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              let rootVc = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController ?? scene.windows.first?.rootViewController else {
            return
        }
        var topVc = rootVc
        while let presented = topVc.presentedViewController {
            topVc = presented
        }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: okTitle, style: .default, handler: nil))
        topVc.present(alert, animated: true, completion: nil)
    }
    #endif

    // MARK: - WKScriptMessageHandler

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              Self.isTrustedOrigin(securityOrigin: message.frameInfo.securityOrigin),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }

        switch action {
        case "syncTelemetryToWatch", "onSessionTelemetryUpdate":
            if let json = body["payload"] as? String {
                syncSnapshotToWatch(jsonString: json)
            }
        case "sendWatchCommand":
            if let json = body["payload"] as? String {
                forwardWatchCommandToWatch(jsonString: json)
            }
        case "pingWatch":
            pingWatch()
        case "requestWatchHeartRate":
            requestWatchHeartRate()
        case "requestStatus", "getWatchConnectionStatus":
            emitConnectionStatusToWebView()
        case "notifyWatchListenerReady":
            isWebListenerReady = true
            flushPendingCommandsToWebView()
            emitConnectionStatusToWebView()
        case "flushPendingWatchCommands":
            isWebListenerReady = true
            flushPendingCommandsToWebView()
        case "installAppOnWatch", "openCompanionApp":
            openCompanionWatchInstaller()
        default:
            break
        }
    }

    // MARK: - WCSessionDelegate (Sole Unified Delegate)

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        emitConnectionStatusToWebView()
        if activationState == .activated {
            let existingCtx = session.receivedApplicationContext
            if !existingCtx.isEmpty {
                handleIncomingWatchDictionary(existingCtx, isRealtime: false)
            }
        }
        if isWebListenerReady {
            flushPendingCommandsToWebView()
        }
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    public func sessionWatchStateDidChange(_ session: WCSession) {
        emitConnectionStatusToWebView()
    }

    public func sessionReachabilityDidChange(_ session: WCSession) {
        emitConnectionStatusToWebView()
    }

    public func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        handleIncomingWatchDictionary(applicationContext, isRealtime: false)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleIncomingWatchDictionary(message, isRealtime: true)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        handleIncomingWatchDictionary(message, isRealtime: true)
        let saved = UserDefaults.standard.string(forKey: prefsKey) ?? "{}"
        var reply: [String: Any] = [
            "type": "PONG",
            "snapshot_json": saved,
            "_ackCmdSeq": lastAckCmdSeq,
            "_ts": Int64(Date().timeIntervalSince1970 * 1000)
        ]
        if let data = saved.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let token = parsed["sessionToken"] as? String, !token.isEmpty {
                reply["sessionToken"] = token
            }
            if let code = parsed["pairingCode"] as? String, !code.isEmpty {
                reply["pairingCode"] = code
            }
        }
        replyHandler(reply)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handleIncomingWatchDictionary(userInfo, isRealtime: false)
    }

    // MARK: - Incoming Watch Command Processing & Safe Queueing

    private func enqueuePendingCommand(_ jsonStr: String) {
        var queue = UserDefaults.standard.stringArray(forKey: pendingQueueKey) ?? []
        if !queue.contains(jsonStr) {
            if queue.count >= maxPendingQueueCount {
                queue.removeFirst(queue.count - maxPendingQueueCount + 1)
            }
            queue.append(jsonStr)
            UserDefaults.standard.set(queue, forKey: pendingQueueKey)
        }
    }

    private func removePendingCommand(_ jsonStr: String) {
        var queue = UserDefaults.standard.stringArray(forKey: pendingQueueKey) ?? []
        if let idx = queue.firstIndex(of: jsonStr) {
            queue.remove(at: idx)
            UserDefaults.standard.set(queue, forKey: pendingQueueKey)
        }
    }

    private func isCommandPayloadFresh(_ dict: [String: Any], nowMs: Int64, isRealtime: Bool) -> Bool {
        let cmdType = (dict["type"] as? String) ?? ""
        let rawTs = extractInt64(dict["_ts"] ?? dict["ts"] ?? dict["updated_at"])
        if rawTs > 0 {
            let ageMs = nowMs - rawTs
            if ageMs > maxWatchCommandAgeMs {
                return false
            }
            return true
        }
        // Queued transferUserInfo / applicationContext without timestamp is unsafe for mutating commands
        if !isRealtime && cmdType != "HR" && cmdType != "PONG" && cmdType != "REQUEST_STATE" {
            return false
        }
        return true
    }

    private func forwardWatchHeartRateIfPresent(_ dict: [String: Any], cmdType: String) {
        let bpm: Int
        if cmdType == "HR" {
            bpm = extractInt(dict["bpm"])
        } else {
            let topHr = extractInt(dict["heartRateBpm"])
            let nestedHr = extractInt((dict["payload"] as? [String: Any])?["heartRateBpm"])
            bpm = topHr > 0 ? topHr : nestedHr
        }

        let statusStr = (dict["status"] as? String) ?? "ok"
        guard cmdType == "HR" || (bpm >= 30 && bpm <= 250) else { return }

        var hrPayload: [String: Any] = [
            "bpm": (bpm >= 30 && bpm <= 250) ? bpm : 0,
            "status": statusStr,
            "deviceName": sanitizeWatchDisplayName(dict["deviceName"] as? String),
            "nodeId": "watchos-companion"
        ]
        let avgBpm = extractInt(dict["avgHeartRateBpm"] ?? dict["avgBpm"] ?? (dict["payload"] as? [String: Any])?["avgHeartRateBpm"])
        let maxBpm = extractInt(dict["maxHeartRateBpm"] ?? dict["maxBpm"] ?? (dict["payload"] as? [String: Any])?["maxHeartRateBpm"])
        if avgBpm >= 30 && avgBpm <= 250 {
            hrPayload["avgBpm"] = avgBpm
        }
        if maxBpm >= 30 && maxBpm <= 250 {
            hrPayload["maxBpm"] = maxBpm
        }

        if let callback = onWatchHeartRateReceived {
            callback(hrPayload)
        } else {
            emitWearHeartRateToWebView(hrPayload)
        }
    }

    private func handleIncomingWatchDictionary(_ dict: [String: Any], isRealtime: Bool) {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if isRealtime {
            lastPongTimestampMs = nowMs
        }

        let cmdType = (dict["type"] as? String) ?? ""
        guard isCommandPayloadFresh(dict, nowMs: nowMs, isRealtime: isRealtime) else {
            emitConnectionStatusToWebView()
            return
        }

        let seq = extractInt64(dict["_cmdSeq"] ?? dict["cmdSeq"])
        if seq > lastAckCmdSeq {
            lastAckCmdSeq = seq
            UserDefaults.standard.set(Int(truncatingIfNeeded: lastAckCmdSeq), forKey: ackSeqKey)
        }

        // Always forward live heart rate (both dedicated HR packets and embedded HR in watch commands)
        forwardWatchHeartRateIfPresent(dict, cmdType: cmdType)

        if cmdType == "PONG" || cmdType == "HR" {
            lastPongTimestampMs = nowMs
            emitConnectionStatusToWebView()
            return
        }

        if cmdType == "REQUEST_STATE" {
            lastPongTimestampMs = nowMs
            if let saved = UserDefaults.standard.string(forKey: prefsKey), !saved.isEmpty {
                syncSnapshotToWatch(jsonString: saved)
            }
            emitConnectionStatusToWebView()
            return
        }

        guard !cmdType.isEmpty else {
            emitConnectionStatusToWebView()
            return
        }

        let cmdId = ((dict["cmdId"] as? String) ?? (dict["_cmdId"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !cmdId.isEmpty && recordAndCheckDuplicateCmdId(cmdId) {
            emitConnectionStatusToWebView()
            return
        }

        var normalized = dict
        if normalized["_ts"] == nil {
            normalized["_ts"] = nowMs
        }
        if cmdType == "ANALYSIS_SHOT_DATA" && normalized["analysisShotJson"] == nil,
           let rawShot = normalized["value"] as? String {
            normalized["analysisShotJson"] = String(rawShot.prefix(3500))
        }

        guard JSONSerialization.isValidJSONObject(normalized),
              let jsonData = try? JSONSerialization.data(withJSONObject: normalized, options: []),
              let jsonStr = String(data: jsonData, encoding: .utf8) else {
            return
        }

        lastPongTimestampMs = nowMs
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let webView = self.webView,
               self.isWebListenerReady,
               Self.isTrustedWebViewURL(webView.url) {
                let escaped = self.escapeForSingleQuotedJs(jsonStr)
                let js = "(function() { if (typeof window.__onNativeWatchMessage === 'function') { return String(window.__onNativeWatchMessage('\(escaped)') || 'DELIVERED'); } return 'PENDING'; })()"
                webView.evaluateJavaScript(js) { [weak self] result, error in
                    let resStr = (result as? String) ?? ""
                    if error != nil || !resStr.contains("DELIVERED") {
                        self?.enqueuePendingCommand(jsonStr)
                    }
                }
            } else {
                self.enqueuePendingCommand(jsonStr)
            }
            self.emitConnectionStatusToWebView()
        }
    }

    public func flushPendingCommandsToWebView() {
        guard isWebListenerReady else { return }
        let rawQueue = UserDefaults.standard.stringArray(forKey: pendingQueueKey) ?? []
        guard !rawQueue.isEmpty else { return }

        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        var validQueue: [String] = []
        for item in rawQueue {
            if let data = item.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let ts = extractInt64(obj["_ts"] ?? obj["ts"])
                if ts <= 0 || (nowMs - ts) <= maxWatchCommandAgeMs {
                    validQueue.append(item)
                }
            }
        }
        UserDefaults.standard.set(validQueue, forKey: pendingQueueKey)
        guard !validQueue.isEmpty else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.webView,
                  Self.isTrustedWebViewURL(webView.url) else {
                return
            }
            for jsonStr in validQueue {
                let escaped = self.escapeForSingleQuotedJs(jsonStr)
                let js = "(function() { if (typeof window.__onNativeWatchMessage === 'function') { return String(window.__onNativeWatchMessage('\(escaped)') || 'DELIVERED'); } return 'PENDING'; })()"
                webView.evaluateJavaScript(js) { [weak self] result, error in
                    let resStr = (result as? String) ?? ""
                    if error == nil && resStr.contains("DELIVERED") {
                        self?.removePendingCommand(jsonStr)
                    }
                }
            }
        }
    }

    public func emitWearHeartRateToWebView(_ dict: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(dict),
              let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
              let jsonStr = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.webView,
                  Self.isTrustedWebViewURL(webView.url) else { return }
            let escaped = self.escapeForSingleQuotedJs(jsonStr)
            webView.evaluateJavaScript(
                "window.__archeryIosLastWearHrJson = '\(escaped)'; if (window.__onNativeWearHrUpdate) { window.__onNativeWearHrUpdate('\(escaped)'); }",
                completionHandler: nil
            )
        }
    }

    public func emitConnectionStatusToWebView() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        let isActivated = (session.activationState == .activated)
        let isPaired = isActivated && session.isPaired
        let isPairedAndInstalled = isPaired && session.isWatchAppInstalled
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let isConnectedLive = isPairedAndInstalled && (session.isReachable || (lastPongTimestampMs > 0 && (nowMs - lastPongTimestampMs) < 60_000))
        let status: [String: Any] = [
            "isNativeAndroid": false,
            "isNativeIos": true,
            "bridgeReady": true,
            "isWatchPaired": isPaired,
            "nativeVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "2.159",
            "connectedNodesCount": isConnectedLive ? 1 : 0,
            "watchAppInstalledCount": isPairedAndInstalled ? 1 : 0,
            "connectedNodes": isConnectedLive ? [["id": "watchos-companion", "displayName": "Smartwatch Deportivo", "isNearby": session.isReachable]] : [],
            "lastMessageAt": lastPongTimestampMs,
            "lastPongAt": lastPongTimestampMs,
            "hasCachedState": UserDefaults.standard.string(forKey: prefsKey) != nil
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: status, options: []),
              let jsonStr = String(data: data, encoding: .utf8) else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.webView,
                  Self.isTrustedWebViewURL(webView.url) else { return }
            let escaped = self.escapeForSingleQuotedJs(jsonStr)
            webView.evaluateJavaScript(
                "if (window.__onWatchConnectionStatus) { window.__onWatchConnectionStatus('\(escaped)'); }",
                completionHandler: nil
            )
        }
    }
}
