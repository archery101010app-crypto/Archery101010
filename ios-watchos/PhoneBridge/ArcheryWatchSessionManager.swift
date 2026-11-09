import Foundation
import WatchConnectivity
import WebKit

/// Native iOS WatchConnectivity Bridge for ARCHERY 101010 (iPhone <-> Apple Watch)
/// Connects the Capacitor / WKWebView JavaScript bridge (`window.ArcheryWatchNativeBridge`)
/// to the Apple Watch companion app using `WCSession` (`sendMessage` + `updateApplicationContext` + `transferUserInfo`).
@objc(ArcheryWatchSessionManager)
public final class ArcheryWatchSessionManager: NSObject, WCSessionDelegate, WKScriptMessageHandler {
    public static let shared = ArcheryWatchSessionManager()

    public weak var webView: WKWebView?
    private let prefsKey = "archery_101010_last_watch_snapshot"
    private let pendingQueueKey = "archery_101010_pending_watch_cmds"
    private var lastAckCmdSeq: Int64 = 0
    private var lastPongTimestampMs: Int64 = 0

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

    // MARK: - Outgoing State from iPhone to Apple Watch

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
        case "pingWatch":
            pingWatch()
        case "flushPendingWatchCommands":
            flushPendingCommandsToWebView()
        default:
            break
        }
    }

    // MARK: - WCSessionDelegate (Incoming Commands from Apple Watch)

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        emitConnectionStatusToWebView()
        flushPendingCommandsToWebView()
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

    private func handleIncomingWatchDictionary(_ dict: [String: Any]) {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        lastPongTimestampMs = nowMs

        if let seq = dict["_cmdSeq"] as? Int64, seq > lastAckCmdSeq {
            lastAckCmdSeq = seq
        }

        if let cmdType = dict["type"] as? String, cmdType == "REQUEST_STATE" {
            if let saved = UserDefaults.standard.string(forKey: prefsKey), !saved.isEmpty {
                syncSnapshotToWatch(jsonString: saved)
            }
            return
        }

        guard let jsonData = try? JSONSerialization.data(withJSONObject: dict, options: []),
              let jsonStr = String(data: jsonData, encoding: .utf8) else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let webView = self.webView {
                let escaped = jsonStr
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "'", with: "\\'")
                let js = "if (typeof window.__onNativeWatchMessage === 'function') { window.__onNativeWatchMessage('\(escaped)'); }"
                webView.evaluateJavaScript(js, completionHandler: nil)
            } else {
                var queue = UserDefaults.standard.stringArray(forKey: self.pendingQueueKey) ?? []
                if queue.count < 60 {
                    queue.append(jsonStr)
                    UserDefaults.standard.set(queue, forKey: self.pendingQueueKey)
                }
            }
        }
    }

    public func flushPendingCommandsToWebView() {
        let queue = UserDefaults.standard.stringArray(forKey: pendingQueueKey) ?? []
        guard !queue.isEmpty else { return }
        UserDefaults.standard.removeObject(forKey: pendingQueueKey)

        DispatchQueue.main.async { [weak self] in
            guard let webView = self?.webView else { return }
            for jsonStr in queue {
                let escaped = jsonStr
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "'", with: "\\'")
                let js = "if (typeof window.__onNativeWatchMessage === 'function') { window.__onNativeWatchMessage('\(escaped)'); }"
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
        }
    }

    private func emitConnectionStatusToWebView() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        let isPaired = session.isPaired && session.isWatchAppInstalled
        let nodesCount = isPaired ? 1 : 0
        let status: [String: Any] = [
            "isNativeAndroid": false,
            "bridgeReady": true,
            "nativeVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "2.76",
            "connectedNodesCount": nodesCount,
            "connectedNodes": isPaired ? [["id": "apple-watch", "displayName": "Apple Watch", "isNearby": session.isReachable]] : [],
            "lastMessageAt": lastPongTimestampMs,
            "lastPongAt": lastPongTimestampMs,
            "hasCachedState": UserDefaults.standard.string(forKey: prefsKey) != nil
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: status, options: []),
              let jsonStr = String(data: data, encoding: .utf8) else { return }

        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "if (window.__onWatchConnectionStatus) { window.__onWatchConnectionStatus(\(jsonStr)); }",
                completionHandler: nil
            )
        }
    }
}
