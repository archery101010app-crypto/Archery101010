import SwiftUI
import WatchConnectivity
import CoreMotion
import WatchKit

/// ARCHERY 101010 — Official Apple Watch App (`watchOS 10+`)
/// WHOOP / Apple / Nike Matte OLED Design DNA:
///  - Official 4K Retina Brand Logo (`brand_logo_full`) at 100% full luminance
///  - Tabular Athletic Numerals (`Outfit` / SF Pro Rounded Tabular)
///  - 4 Screens synchronized in real time with iPhone via `WatchConnectivity`:
///      0: Contador 4 Dígitos (`0 0 0 0`) + Auto-Tiro + `mts · kcal`
///      1: Puntuación de Tanda (`X, 10, 9, 8, 7, M`) + `BORRAR` / `SIG. TANDA →`
///      2: Métricas Biométricas (`DISTANCIA RECORRIDA` en `mts · ft` + `GASTO ENERGÉTICO` en `kcal`)
///      3: Resumen de Sesión + `ENVIAR SESIÓN A COACH`
@main
struct Archery101010WatchApp: App {
    @StateObject private var viewModel = WatchSessionViewModel()

    var body: some Scene {
        WindowGroup {
            ArcheryWatchPagerView(vm: viewModel)
                .background(Color(red: 2/255, green: 3/255, blue: 5/255))
        }
    }
}

final class WatchSessionViewModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var screenIndex: Int = 0
    @Published var arrowCount: Int = 0
    @Published var totalScore: Int = 0
    @Published var currentEnd: Int = 1
    @Published var endsCount: Int = 12
    @Published var arrowsPerEnd: Int = 6
    @Published var currentEndArrows: [String] = []
    @Published var distanceM: Int = 18
    @Published var bowPoundageLbs: Double = 38.0
    @Published var stepsCount: Int = 0
    @Published var distanceWalkedM: Double = 0.0
    @Published var syncedActiveKcal: Int = -1
    @Published var autoDetectEnabled: Bool = true
    @Published var sensitivityLevel: Int = 1 // 0: BAJA, 1: MEDIA, 2: ALTA
    @Published var isWalkingPaused: Bool = false
    @Published var isPhoneConnected: Bool = false

    private let motionManager = CMMotionManager()
    private let pedometer = CMPedometer()
    private var lastShotTimeMs: Int64 = 0
    private var lastStepTimeMs: Int64 = 0
    private var prevStepTimeMs: Int64 = 0
    private var walkingLockUntilMs: Int64 = 0
    private var smoothedMagG: Double = 1.0
    private var preShotLinearHistory: [Double] = Array(repeating: 0.10, count: 16)
    private var preShotHistoryIdx: Int = 0
    private var preShotHistoryCount: Int = 0
    private var cmdSequence: Int64 = 0

    override init() {
        super.init()
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "autoDetectEnabled") != nil {
            autoDetectEnabled = defaults.bool(forKey: "autoDetectEnabled")
        }
        if defaults.object(forKey: "sensitivityLevel") != nil {
            sensitivityLevel = max(0, min(2, defaults.integer(forKey: "sensitivityLevel")))
        }
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
        startSensors()
    }

    private func isPreShotAnchorSteady(maxQuietAvgG: Double) -> Bool {
        if preShotHistoryCount < 8 {
            return true
        }
        let samplesToCheck = min(10, preShotHistoryCount - 3)
        if samplesToCheck <= 0 { return true }
        var sum = 0.0
        let oldestIdx = (preShotHistoryIdx - preShotHistoryCount + 16) % 16
        for i in 0..<samplesToCheck {
            let idx = (oldestIdx + i) % 16
            sum += preShotLinearHistory[idx]
        }
        return (sum / Double(samplesToCheck)) <= maxQuietAvgG
    }

    private func recordDetectedStep(nowMs: Int64) {
        prevStepTimeMs = lastStepTimeMs
        lastStepTimeMs = nowMs
        if (nowMs - prevStepTimeMs) <= 4200 {
            walkingLockUntilMs = nowMs + 3800
        } else {
            walkingLockUntilMs = max(walkingLockUntilMs, nowMs + 2200)
        }
        isWalkingPaused = true
    }

    func cycleSensitivityMode() {
        if !autoDetectEnabled {
            autoDetectEnabled = true
            sensitivityLevel = 1 // MEDIA
        } else if sensitivityLevel == 1 {
            sensitivityLevel = 0 // BAJA
        } else if sensitivityLevel == 0 {
            sensitivityLevel = 2 // ALTA
        } else {
            autoDetectEnabled = false // MODO MANUAL
        }
        let defaults = UserDefaults.standard
        defaults.set(autoDetectEnabled, forKey: "autoDetectEnabled")
        defaults.set(sensitivityLevel, forKey: "sensitivityLevel")
        WKInterfaceDevice.current().play(.click)
        sendCommandToPhone([
            "type": "TOGGLE_AUTO_DETECT",
            "enabled": autoDetectEnabled,
            "sensitivityLevel": sensitivityLevel
        ])
    }

    var currentStatusPillLabel: String {
        if !autoDetectEnabled {
            return "MODO MANUAL"
        }
        if isWalkingPaused {
            return "PAUSA · CAMINANDO"
        }
        let sens = (sensitivityLevel == 0) ? "BAJA" : ((sensitivityLevel == 2) ? "ALTA" : "MEDIA")
        return "AUTO · \(sens) · LIVE"
    }

    private func startSensors() {
        if CMPedometer.isStepCountingAvailable() {
            pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                guard let self = self, let data = data else { return }
                DispatchQueue.main.async {
                    let newSteps = data.numberOfSteps.intValue
                    if newSteps > self.stepsCount {
                        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
                        self.recordDetectedStep(nowMs: nowMs)
                    }
                    self.stepsCount = newSteps
                    let pedDist = data.distance?.doubleValue ?? (Double(self.stepsCount) * 0.76)
                    self.distanceWalkedM = max(self.distanceWalkedM, pedDist)
                }
            }
        }

        if motionManager.isAccelerometerAvailable {
            motionManager.accelerometerUpdateInterval = 0.025 // 40 Hz
            motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
                guard let self = self, self.autoDetectEnabled, let acc = data?.acceleration else { return }
                let magG = sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z)
                let dynamicG = magG - self.smoothedMagG
                self.smoothedMagG = (0.95 * self.smoothedMagG) + (0.05 * magG)
                let linearG = abs(magG - 1.0)
                let nowMs = Int64(Date().timeIntervalSince1970 * 1000)

                if self.isWalkingPaused && nowMs >= self.walkingLockUntilMs {
                    self.isWalkingPaused = false
                }

                let thresholdG = (self.sensitivityLevel == 0) ? 2.10 : ((self.sensitivityLevel == 2) ? 1.45 : 1.72)
                let quietLimitG = (self.sensitivityLevel == 0) ? 0.21 : ((self.sensitivityLevel == 2) ? 0.33 : 0.26)
                let cooldownMs: Int64 = (self.sensitivityLevel == 0) ? 3800 : ((self.sensitivityLevel == 2) ? 2600 : 3200)
                let isWalkingBlocked = (nowMs < self.walkingLockUntilMs) || ((nowMs - self.lastStepTimeMs) < 2200)

                if !isWalkingBlocked
                    && linearG >= thresholdG
                    && (nowMs - self.lastShotTimeMs) > cooldownMs
                    && self.isPreShotAnchorSteady(maxQuietAvgG: quietLimitG) {
                    self.lastShotTimeMs = nowMs
                    self.preShotHistoryCount = 0
                    self.incrementArrow(delta: 1, source: "watch_auto")
                } else if dynamicG >= 0.12 && dynamicG <= 1.15 && (nowMs - self.lastStepTimeMs) > 380 && (nowMs - self.lastShotTimeMs) > 1400 {
                    self.recordDetectedStep(nowMs: nowMs)
                    self.stepsCount += 1
                    self.distanceWalkedM = max(self.distanceWalkedM + 0.76, Double(self.stepsCount) * 0.76)
                }

                self.preShotLinearHistory[self.preShotHistoryIdx] = min(linearG, 1.2)
                self.preShotHistoryIdx = (self.preShotHistoryIdx + 1) % 16
                if self.preShotHistoryCount < 16 {
                    self.preShotHistoryCount += 1
                }
            }
        }
    }

    var walkedMetersInt: Int {
        max(0, Int(round(max(distanceWalkedM, Double(stepsCount) * 0.76))))
    }

    var walkedFeetInt: Int {
        max(0, Int(round(Double(walkedMetersInt) * 3.28084)))
    }

    var activeKcal: Int {
        if arrowCount <= 0 && walkedMetersInt < 10 {
            return max(0, syncedActiveKcal)
        }
        let kcalPerArrow = 0.56 + (max(15.0, bowPoundageLbs) * 0.0165)
        let walkKcal = (Double(walkedMetersInt) / 1000.0) * 72.0 * 0.78
        return Int(round(Double(arrowCount) * kcalPerArrow + walkKcal))
    }

    func incrementArrow(delta: Int, source: String = "watch_manual") {
        arrowCount = max(0, arrowCount + delta)
        WKInterfaceDevice.current().play(delta > 0 ? .DirectionUp : .DirectionDown)
        sendCommandToPhone([
            "type": delta > 0 ? "INCREMENT_ARROW" : "DECREMENT_ARROW",
            "delta": delta,
            "source": source,
            "totalScore": totalScore
        ])
    }

    func recordScore(_ label: String) {
        if currentEndArrows.count >= arrowsPerEnd {
            if currentEnd < endsCount {
                currentEnd += 1
                currentEndArrows.removeAll()
            } else {
                return
            }
        }
        currentEndArrows.append(label)
        let pts = (label == "X" || label == "10") ? 10 : (label == "M" ? 0 : (Int(label) ?? 0))
        totalScore += pts
        arrowCount += 1
        WKInterfaceDevice.current().play(.click)
        sendCommandToPhone([
            "type": "SCORE_INPUT",
            "payload": ["value": label, "totalScore": totalScore],
            "value": label,
            "totalScore": totalScore
        ])
    }

    func undoLastScore() {
        guard !currentEndArrows.isEmpty else { return }
        let removed = currentEndArrows.removeLast()
        let pts = (removed == "X" || removed == "10") ? 10 : (removed == "M" ? 0 : (Int(removed) ?? 0))
        totalScore = max(0, totalScore - pts)
        arrowCount = max(0, arrowCount - 1)
        WKInterfaceDevice.current().play(.click)
        sendCommandToPhone(["type": "UNDO_ARROW", "totalScore": totalScore])
    }

    func advanceToNextEnd() {
        guard !currentEndArrows.isEmpty else { return }
        currentEndArrows.removeAll()
        currentEnd = min(endsCount, currentEnd + 1)
        WKInterfaceDevice.current().play(.success)
        sendCommandToPhone(["type": "NEXT_END"])
    }

    func finishSession() {
        WKInterfaceDevice.current().play(.success)
        sendCommandToPhone(["type": "FINISH_SESSION_FROM_WATCH"])
        arrowCount = 0
        totalScore = 0
        currentEnd = 1
        currentEndArrows.removeAll()
        screenIndex = 0
    }

    func sendCommandToPhone(_ payload: [String: Any]) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        cmdSequence += 1
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        var enriched = payload
        enriched["_cmdId"] = "\(nowMs)-\(cmdSequence)"
        enriched["_cmdSeq"] = cmdSequence
        enriched["_ts"] = nowMs

        if session.isReachable {
            session.sendMessage(enriched, replyHandler: nil, errorHandler: nil)
        }
        session.transferUserInfo(enriched)
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isPhoneConnected = session.isReachable
        }
        if session.isReachable {
            session.sendMessage(["type": "REQUEST_STATE"], replyHandler: nil, errorHandler: nil)
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isPhoneConnected = session.isReachable
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        handleIncomingPhoneContext(applicationContext)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleIncomingPhoneContext(message)
    }

    private func handleIncomingPhoneContext(_ dict: [String: Any]) {
        guard let snapStr = dict["snapshot_json"] as? String,
              let data = snapStr.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let obj = (json["payload"] as? [String: Any]) ?? json
        DispatchQueue.main.async {
            self.isPhoneConnected = true
            if let arrows = obj["arrowsCount"] as? Int { self.arrowCount = max(0, arrows) }
            if let score = obj["totalScore"] as? Int { self.totalScore = max(0, score) }
            if let distM = obj["distanceM"] as? Int { self.distanceM = distM }
            if let perEnd = obj["arrowsPerEnd"] as? Int { self.arrowsPerEnd = max(1, perEnd) }
            if let ends = obj["endsCount"] as? Int { self.endsCount = max(1, ends) }
            if let curIdx = obj["currentEndIndex"] as? Int { self.currentEnd = curIdx + 1 }
            if let walked = obj["distanceWalkedM"] as? Double { self.distanceWalkedM = max(self.distanceWalkedM, walked) }
            if let kcal = obj["activeKcal"] as? Int { self.syncedActiveKcal = kcal }
        }
    }
}

struct ArcheryWatchPagerView: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        TabView(selection: $vm.screenIndex) {
            CounterWatchScreen(vm: vm).tag(0)
            ScorePadWatchScreen(vm: vm).tag(1)
            BiometricsWatchScreen(vm: vm).tag(2)
            SummaryWatchScreen(vm: vm).tag(3)
        }
        .tabViewStyle(.page)
    }
}

struct WatchBrandHeaderView: View {
    let pillText: String
    var isYellowPill: Bool = false

    var body: some View {
        let accentColor = isYellowPill
            ? Color(red: 1, green: 229/255, blue: 0)
            : Color(red: 0/255, green: 168/255, blue: 243/255)
        let bgFill = isYellowPill
            ? Color(red: 16/255, green: 16/255, blue: 6/255)
            : Color(red: 4/255, green: 11/255, blue: 18/255)

        VStack(spacing: 3) {
            Image("brand_logo_full")
                .resizable()
                .scaledToFit()
                .frame(height: 11)
            HStack(spacing: 4) {
                Circle()
                    .fill(accentColor)
                    .frame(width: 4.5, height: 4.5)
                Text(pillText)
                    .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(bgFill)
            .overlay(
                Capsule().stroke(accentColor.opacity(0.55), lineWidth: 1)
            )
            .clipShape(Capsule())
        }
    }
}

struct CounterWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel

    private var digits: [String] {
        String(format: "%04d", min(9999, max(0, vm.arrowCount))).map { String($0) }
    }

    var body: some View {
        VStack(spacing: 6) {
            WatchBrandHeaderView(
                pillText: vm.currentStatusPillLabel,
                isYellowPill: vm.autoDetectEnabled && vm.isWalkingPaused
            )
                .onTapGesture { vm.cycleSensitivityMode() }

            HStack(spacing: 4) {
                ForEach(0..<4, id: \.self) { idx in
                    Text(digits[idx])
                        .font(.system(size: 22, weight: .black, design: .rounded).monospacedDigit())
                        .foregroundColor(idx == 3 ? Color(red: 1, green: 229/255, blue: 0) : .white)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background(Color(red: 11/255, green: 14/255, blue: 21/255))
                        .cornerRadius(6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(idx == 3 ? Color(red: 1, green: 229/255, blue: 0) : Color.white.opacity(0.14), lineWidth: 1)
                        )
                }
            }
            .padding(5)
            .background(Color(red: 7/255, green: 9/255, blue: 14/255))
            .cornerRadius(10)
            .onTapGesture { vm.incrementArrow(delta: 1) }

            HStack {
                Button(action: { vm.incrementArrow(delta: -1) }) {
                    Text("−1")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                }
                .buttonStyle(.plain)
                .frame(width: 32, height: 22)
                .background(Color(red: 24/255, green: 7/255, blue: 9/255))
                .clipShape(Capsule())

                Spacer()

                VStack(spacing: 1) {
                    Text("\(vm.walkedMetersInt) mts · \(vm.activeKcal) kcal")
                        .font(.system(size: 10, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundColor(.white)
                    Text("TANDA \(vm.currentEnd) · \(vm.distanceM) M")
                        .font(.system(size: 7.5, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundColor(.gray)
                }

                Spacer()

                Button(action: { vm.incrementArrow(delta: 1) }) {
                    Text("+1")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                }
                .buttonStyle(.plain)
                .frame(width: 32, height: 22)
                .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 8)
    }
}

struct ScorePadWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel
    private let keys = ["X", "10", "9", "8", "7", "M"]

    var body: some View {
        VStack(spacing: 5) {
            WatchBrandHeaderView(pillText: "TANDA \(vm.currentEnd)/\(vm.endsCount) · \(vm.totalScore) PTS")

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 4) {
                ForEach(keys, id: \.self) { key in
                    Button(action: { vm.recordScore(key) }) {
                        Text(key)
                            .font(.system(size: 13, weight: .black, design: .rounded))
                            .foregroundColor(["X", "10", "9"].contains(key) ? Color(red: 1, green: 229/255, blue: 0) : .white)
                            .frame(maxWidth: .infinity, minHeight: 24)
                            .background(Color(red: 12/255, green: 16/255, blue: 23/255))
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 5) {
                Button(action: { vm.undoLastScore() }) {
                    Text("BORRAR")
                        .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                        .frame(maxWidth: .infinity, minHeight: 20)
                        .background(Color.white.opacity(0.08))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)

                Button(action: { vm.advanceToNextEnd() }) {
                    Text("SIG. TANDA →")
                        .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                        .frame(maxWidth: .infinity, minHeight: 20)
                        .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
    }
}

struct BiometricsWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        VStack(spacing: 6) {
            WatchBrandHeaderView(pillText: "GPS · PASOS EN VIVO")

            VStack(alignment: .leading, spacing: 2) {
                Text("DISTANCIA RECORRIDA")
                    .font(.system(size: 7.5, weight: .bold, design: .rounded))
                    .foregroundColor(.gray)
                Text("\(vm.walkedMetersInt) mts · \(vm.walkedFeetInt) ft")
                    .font(.system(size: 14, weight: .black, design: .rounded).monospacedDigit())
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(7)
            .background(Color(red: 7/255, green: 9/255, blue: 14/255))
            .cornerRadius(8)

            VStack(alignment: .leading, spacing: 2) {
                Text("GASTO ENERGÉTICO")
                    .font(.system(size: 7.5, weight: .bold, design: .rounded))
                    .foregroundColor(.gray)
                Text("\(vm.activeKcal) kcal")
                    .font(.system(size: 14, weight: .black, design: .rounded).monospacedDigit())
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(7)
            .background(Color(red: 7/255, green: 9/255, blue: 14/255))
            .cornerRadius(8)
        }
        .padding(.horizontal, 8)
    }
}

struct SummaryWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        VStack(spacing: 6) {
            WatchBrandHeaderView(pillText: "RESUMEN DE SESIÓN")

            HStack(spacing: 5) {
                VStack {
                    Text("FLECHAS")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundColor(.gray)
                    Text("\(vm.arrowCount)")
                        .font(.system(size: 14, weight: .black).monospacedDigit())
                }
                .frame(maxWidth: .infinity)
                .padding(5)
                .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                .cornerRadius(8)

                VStack {
                    Text("PUNTOS")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundColor(.gray)
                    Text("\(vm.totalScore)")
                        .font(.system(size: 14, weight: .black).monospacedDigit())
                        .foregroundColor(Color(red: 1, green: 229/255, blue: 0))
                }
                .frame(maxWidth: .infinity)
                .padding(5)
                .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                .cornerRadius(8)
            }

            Text("\(vm.walkedMetersInt) mts · \(vm.walkedFeetInt) ft · \(vm.activeKcal) kcal")
                .font(.system(size: 10, weight: .heavy, design: .rounded).monospacedDigit())
                .foregroundColor(.white)

            Button(action: { vm.finishSession() }) {
                Text("ENVIAR SESIÓN A COACH")
                    .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                    .frame(maxWidth: .infinity, minHeight: 24)
                    .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
    }
}
