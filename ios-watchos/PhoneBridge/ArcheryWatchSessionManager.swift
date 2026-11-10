import Foundation
import WatchConnectivity
import WebKit

/// Native iOS WatchConnectivity Bridge for ARCHERY 101010
/// Connects the Capacitor / WKWebView JavaScript bridge (`window.webkit.messageHandlers.ArcheryWatchNativeBridge`)
/// to the watchOS companion app using `WCSession` (`sendMessage` + `updateApplicationContext` + `transferUserInfo`).
@objc(ArcheryWatchSessionManager)
public final class ArcheryWatchSessionManager: NSObject, WCSessionDelegate, WKScriptMessageHandler {
    public static let shared = ArcheryWatchSessionManager()

    public weak var webView: WKWebView?
    private let prefsKey = "archery_101010_last_watch_snapshot"
    private let pendingQueueKey = "archery_101010_pending_watch_cmds"
    private var lastAckCmdSeq: Int64 = 0
    private var lastPongTimestampMs: Int64 = 0
    private var isWebListenerReady: Bool = false

    private override init() {
        super.init()
    }

    public func activate(with webView: WKWebView?) {
        self.webView = webView
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
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

    // MARK: - Outgoing State & Commands from Phone to Watch

    public func syncSnapshotToWatch(jsonString: String) {
        guard !jsonString.isEmpty else { return }
        UserDefaults.standard.set(jsonString, forKey: prefsKey)

        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        let payload: [String: Any] = [
            "type": "STATE_UPDATE",
            "snapshot_json": jsonString,
            "_ackCmdSeq": lastAckCmdSeq,
            "updated_at": Int64(Date().timeIntervalSince1970 * 1000)
        ]

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
        guard session.activationState == .activated else { return }

        var payload: [String: Any] = [
            "type": "PHONE_COMMAND",
            "command_json": jsonString,
            "updated_at": Int64(Date().timeIntervalSince1970 * 1000)
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
                    session.sendMessage(["type": "PING", "_ts": Int64(Date().timeIntervalSince1970 * 1000)], replyHandler: { [weak self] reply in
                        self?.lastPongTimestampMs = Int64(Date().timeIntervalSince1970 * 1000)
                        if !reply.isEmpty {
                            self?.handleIncomingWatchDictionary(reply)
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
        }

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        } else if session.isPaired && session.isWatchAppInstalled {
            session.transferUserInfo(payload)
        }
    }

    public func pingWatch() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if session.isReachable {
            session.sendMessage(["type": "PING", "_ts": nowMs], replyHandler: { [weak self] _ in
                self?.lastPongTimestampMs = Int64(Date().timeIntervalSince1970 * 1000)
                self?.emitConnectionStatusToWebView()
            }, errorHandler: nil)
        }
        if let saved = UserDefaults.standard.string(forKey: prefsKey), !saved.isEmpty {
            syncSnapshotToWatch(jsonString: saved)
        }
        emitConnectionStatusToWebView()
    }

    // MARK: - WKScriptMessageHandler

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

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
        case "requestStatus":
            emitConnectionStatusToWebView()
        case "notifyWatchListenerReady":
            isWebListenerReady = true
            flushPendingCommandsToWebView()
            emitConnectionStatusToWebView()
        case "flushPendingWatchCommands":
            isWebListenerReady = true
            flushPendingCommandsToWebView()
        default:
            break
        }
    }

    // MARK: - WCSessionDelegate (Incoming Commands from Watch)

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        emitConnectionStatusToWebView()
        if isWebListenerReady {
            flushPendingCommandsToWebView()
        }
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    public func sessionReachabilityDidChange(_ session: WCSession) {
        emitConnectionStatusToWebView()
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleIncomingWatchDictionary(message)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        handleIncomingWatchDictionary(message)
        let saved = UserDefaults.standard.string(forKey: prefsKey) ?? "{}"
        replyHandler([
            "type": "PONG",
            "snapshot_json": saved,
            "_ackCmdSeq": lastAckCmdSeq
        ])
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handleIncomingWatchDictionary(userInfo)
    }

    private func enqueuePendingCommand(_ jsonStr: String) {
        var queue = UserDefaults.standard.stringArray(forKey: pendingQueueKey) ?? []
        if !queue.contains(jsonStr) {
            if queue.count >= 100 {
                queue.removeFirst()
            }
            queue.append(jsonStr)
            UserDefaults.standard.set(queue, forKey: pendingQueueKey)
        }
    }

    private func handleIncomingWatchDictionary(_ dict: [String: Any]) {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        lastPongTimestampMs = nowMs

        if let seq = dict["_cmdSeq"] as? Int64, seq > lastAckCmdSeq {
            lastAckCmdSeq = seq
        } else if let seqInt = dict["_cmdSeq"] as? Int, Int64(seqInt) > lastAckCmdSeq {
            lastAckCmdSeq = Int64(seqInt)
        }

        if let cmdType = dict["type"] as? String {
            if cmdType == "PONG" {
                emitConnectionStatusToWebView()
                return
            }
            if cmdType == "REQUEST_STATE" {
                if let saved = UserDefaults.standard.string(forKey: prefsKey), !saved.isEmpty {
                    syncSnapshotToWatch(jsonString: saved)
                }
                emitConnectionStatusToWebView()
                return
            }
        }

        guard let jsonData = try? JSONSerialization.data(withJSONObject: dict, options: []),
              let jsonStr = String(data: jsonData, encoding: .utf8) else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let webView = self.webView {
                let escaped = self.escapeForSingleQuotedJs(jsonStr)
                let js = "(function() { if (typeof window.__onNativeWatchMessage === 'function') { window.__onNativeWatchMessage('\(escaped)'); return 'DELIVERED'; } return 'PENDING'; })()"
                webView.evaluateJavaScript(js) { [weak self] result, error in
                    let resStr = result as? String ?? ""
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
        let queue = UserDefaults.standard.stringArray(forKey: pendingQueueKey) ?? []
        guard !queue.isEmpty else { return }
        UserDefaults.standard.removeObject(forKey: pendingQueueKey)

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let webView = self.webView else {
                for item in queue { self.enqueuePendingCommand(item) }
                return
            }
            for jsonStr in queue {
                let escaped = self.escapeForSingleQuotedJs(jsonStr)
                let js = "(function() { if (typeof window.__onNativeWatchMessage === 'function') { window.__onNativeWatchMessage('\(escaped)'); return 'DELIVERED'; } return 'PENDING'; })()"
                webView.evaluateJavaScript(js) { [weak self] result, error in
                    let resStr = result as? String ?? ""
                    if error != nil || !resStr.contains("DELIVERED") {
                        self?.enqueuePendingCommand(jsonStr)
                    }
                }
            }
        }
    }

    private func emitConnectionStatusToWebView() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        let isPairedAndInstalled = session.isPaired && session.isWatchAppInstalled
        let isConnectedLive = isPairedAndInstalled && (session.isReachable || (lastPongTimestampMs > 0 && (Int64(Date().timeIntervalSince1970 * 1000) - lastPongTimestampMs) < 60_000))
        let status: [String: Any] = [
            "isNativeAndroid": false,
            "isNativeIos": true,
            "bridgeReady": true,
            "nativeVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "2.88",
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
            guard let self = self else { return }
            let escaped = self.escapeForSingleQuotedJs(jsonStr)
            self.webView?.evaluateJavaScript(
                "if (window.__onWatchConnectionStatus) { window.__onWatchConnectionStatus('\(escaped)'); }",
                completionHandler: nil
            )
        }
    }
}
