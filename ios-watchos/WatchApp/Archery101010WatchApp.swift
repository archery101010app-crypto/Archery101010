import SwiftUI
import Foundation
import WatchConnectivity
import CoreMotion
import HealthKit
import WatchKit
#if canImport(AppIntents)
import AppIntents
#endif

/// ARCHERY 101010 — Official WatchOS Companion App (`watchOS 9+`)
/// Matte OLED Design DNA:
///  - Official 4K Retina Brand Logo (`brand_logo_full`) at 100% full luminance
///  - Tabular Athletic Numerals (`Outfit` / Rounded Tabular)
///  - Bilingual ES/EN + Metric/Imperial Regional Units
///  - 5 Screens synchronized in real time via `WatchConnectivity` + Spark-Safe 256-Bit Cloud Token:
///      0: 4-Digit Counter (`0 0 0 0`) + Analysis Mode + Walked Distance & `kcal`
///      1: Scrollable XL 4x3 Scorepad (`X, 10..1, M`) + All End Slots + `BORRAR`/`DEL` & `SIG. TANDA`/`NEXT END`
///      2: Biometrics (`PULSO`, `DISTANCIA`/`DISTANCE`, `PASOS`/`STEPS`, `kcal`)
///      3: Session Summary + 2-Tap Confirmed `GUARDAR`/`SAVE`
///      4: 6-Digit Cloud Handshake (`watch_pairings` -> `watch_sessions` + Digital Crown)
@main
struct Archery101010WatchApp: App {
    @StateObject private var viewModel = WatchSessionViewModel.shared

    var body: some Scene {
        WindowGroup {
            ArcheryWatchPagerView(vm: viewModel)
                .background(Color(red: 2/255, green: 3/255, blue: 5/255))
        }
    }
}

#if canImport(AppIntents)
@available(watchOS 10.0, *)
struct ArcheryHardwareActionIntent: AppIntent {
    static var title: LocalizedStringResource = "Registrar Acción de Tiro"
    static var description = IntentDescription("Inicia o detiene el análisis biomecánico o suma una flecha en ARCHERY 101010.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        WatchSessionViewModel.shared.handleHardwarePrimaryAction()
        return .result()
    }
}
#endif

private struct QueuedCloudWatchCommand: Codable {
    let cmdId: String
    let cmdSeq: Int64
    let createdAtMs: Int64
    let eventType: String
    let extraValue: String?
    let delta: Int?
    let totalScore: Int
    let stepsCount: Int
    let distanceWalkedM: Int
    let activeKcal: Int
    let heartRateBpm: Int
    let avgHeartRateBpm: Int
    let maxHeartRateBpm: Int
    let enabled: Bool?
    let sensitivityLevel: Int?
    let calibrateZeroAt: Int64?
    let zeroGravityVec: [Double]?
}

final class WatchSessionViewModel: NSObject, ObservableObject, WCSessionDelegate, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    static let shared = WatchSessionViewModel()

    @Published var screenIndex: Int = 0 {
        didSet {
            if screenIndex != oldValue {
                markUserActivity(isWriteAction: false)
                if screenIndex == 2 && heartRateBpm == 0 {
                    startHeartRateStreamingIfSupported()
                }
            }
        }
    }
    @Published var arrowCount: Int = 0
    @Published var totalScore: Int = 0
    @Published var currentEnd: Int = 1
    @Published var endsCount: Int = 12
    @Published var arrowsPerEnd: Int = 6
    @Published var currentEndArrows: [String] = []
    @Published var distanceM: Int = 18
    @Published var bowPoundageLbs: Double = 38.0
    @Published var athleteWeightKg: Double = 72.0
    @Published var practiceTypeStr: String = "Práctica"
    @Published var stepsCount: Int = 0
    @Published var distanceWalkedM: Double = 0.0
    @Published var syncedActiveKcal: Int = -1
    @Published var heartRateBpm: Int = 0
    @Published var avgHeartRateBpm: Int = 0
    @Published var maxHeartRateBpm: Int = 0
    @Published var hrSensorStatus: String = "idle"
    @Published var autoDetectEnabled: Bool = false
    @Published var analysisMode: Bool = false
    @Published var manualAnalysisRecording: Bool = false
    @Published var manualAnalysisElapsedSec: Double = 0.0
    @Published var lastAnalysisStabPct: Int = 0
    @Published var sensitivityLevel: Int = 1 // 0: BAJA/LOW, 1: MEDIA/MED, 2: ALTA/HIGH
    @Published var isWalkingPaused: Bool = false
    @Published var isPhoneConnected: Bool = false
    @Published var scorepadHintText: String = ""

    // Finish Session 2-tap confirmation & unlinked protection
    @Published var showFinishConfirmation: Bool = false
    @Published var showUnlinkedSaveWarning: Bool = false

    // 6-Digit -> 256-Bit Cloud Sync state
    @Published var pairingDigits: [Int] = [1, 0, 0, 0, 0, 0]
    @Published var hasPairingCode: Bool = false
    @Published var pairingCode: String = ""
    @Published var cloudSessionToken: String = ""
    @Published var isEditingCode: Bool = false
    @Published var editDigitPos: Int = 0
    @Published var isCloudSynced: Bool = false
    @Published var isClaimingPairing: Bool = false
    @Published var cloudStatusMessage: String = ""
    @Published var pendingQueueCount: Int = 0

    var bowTypeStr: String = "Barebow"
    var bowWristStr: String = "LEFT"
    private var calibratedZeroVec: [Double]? = nil

    private var manualAnalysisStartMs: Int64 = 0
    private var manualTimer: Timer?
    private var lastHandledStartAt: Int64 = 0
    private var lastHandledStopAt: Int64 = 0
    private var lastHandledCalibrateAt: Int64 = 0

    var isSpanish: Bool {
        if #available(watchOS 9.0, iOS 16.0, *) {
            return Locale.current.language.languageCode?.identifier == "es"
        } else {
            return (Locale.current.languageCode ?? "en").lowercased().hasPrefix("es")
        }
    }

    var isImperial: Bool {
        return !Locale.current.usesMetricSystem
    }

    var isScoredPractice: Bool {
        let lower = practiceTypeStr.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if lower == "volumen" || lower == "volume" {
            return totalScore > 0 || !currentEndArrows.isEmpty
        }
        return true
    }

    func tr(_ es: String, _ en: String) -> String {
        return isSpanish ? es : en
    }

    // Persistent UserDefaults keys
    private let deviceIdPrefsKey = "archery_watchos_device_id"
    private let pairingCodePrefsKey = "pairingCode"
    private let sessionTokenPrefsKey = "cloudSessionToken"
    private let cmdSeqPrefsKey = "archery_watchos_cmd_seq"
    private let fifoQueuePrefsKey = "archery_watchos_pending_cloud_fifo_v2"
    private let weightKgPrefsKey = "archery_watchos_athlete_weight_kg"
    private let practiceTypePrefsKey = "archery_watchos_practice_type"
    private let maxCloudQueueSize = 100

    private(set) var watchDeviceId: String = ""
    private var pendingCloudCmdQueue: [QueuedCloudWatchCommand] = []
    private var isSendingCloudCmd: Bool = false
    private var pairingTerminalError: Bool = false

    private lazy var cloudUrlSession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.urlCache = nil
        cfg.timeoutIntervalForRequest = 12.0
        cfg.timeoutIntervalForResource = 20.0
        return URLSession(configuration: cfg)
    }()

    private lazy var imuQueue: OperationQueue = {
        let q = OperationQueue()
        q.name = "com.archery101010.watch.imu100hz"
        q.maxConcurrentOperationCount = 1
        q.qualityOfService = .userInteractive
        return q
    }()
    private let imuLock = NSLock()

    private let motionManager = CMMotionManager()
    private let pedometer = CMPedometer()
    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?
    private var heartRateQuery: HKAnchoredObjectQuery?
    private var heartRateAnchor: HKQueryAnchor?
    private var seenHrSampleIds: [UUID] = []
    private var hrSampleWatchdogWorkItem: DispatchWorkItem?
    private var lastHrSampleReceivedMs: Int64 = 0
    private var hrSampleSum: Int = 0
    private var hrSampleCount: Int = 0
    private var lastHrPhoneSendMs: Int64 = 0
    private var lastHrCloudPushMs: Int64 = 0

    private var hasHardwarePedometer: Bool = false
    private var currentSessionId: String = ""
    private var lastShotTimeMs: Int64 = 0
    private var lastStepTimeMs: Int64 = 0
    private var prevStepTimeMs: Int64 = 0
    private var recentStepBoutCount: Int = 0
    private var walkingLockUntilMs: Int64 = 0
    private var smoothedMagG: Double = 1.0
    private var latestAccVec: [Double] = [0.0, 0.0, -1.0]

    // 7-Gate 3D + Gyro Biomechanical Ring Buffer (100Hz processed on dedicated serial imuQueue)
    private struct MotionSample {
        let t: Int64
        let ax: Double
        let ay: Double
        let az: Double
        let magG: Double
        let linG: Double
        let gyroRad: Double
    }
    private var motionBuf: [MotionSample] = []
    private var latestGyroRad: Double = -1.0
    private var lastGyroMs: Int64 = 0
    private var prevSigG: Double = 0.0
    private var prevPrevSigG: Double = 0.0
    private var peakTimesMs: [Int64] = []

    // Post-release 220ms follow-through verification (100% IMU)
    private var pendingShotActive: Bool = false
    private var pendingShotStartMs: Int64 = 0
    private var pendingFollowN: Int = 0
    private var pendingFollowSumLinG: Double = 0.0
    private var pendingFollowSumAxG: Double = 0.0
    private var pendingFollowSumGyro: Double = 0.0
    private var pendingFollowGyroN: Int = 0

    private var accelCandidateStepT: [Int64] = []
    private var accelRhythmicCadenceActive: Bool = false
    private var lastSyncedStepsCount: Int = 0
    private var lastTelemetrySyncTimeMs: Int64 = 0
    private var cmdSequence: Int64 = 0
    private var cloudPollTimer: Timer?
    private var lastActivityMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    private var lastCloudPollMs: Int64 = 0
    private var lastLocalActionMs: Int64 = 0
    private var lastRemoteStateSig: String = ""
    private var lastPhoneContextSig: String = ""

    override init() {
        super.init()
        let bootNowMs = Int64(Date().timeIntervalSince1970 * 1000)
        lastActivityMs = bootNowMs
        let defaults = UserDefaults.standard

        // 1. Stable persisted watchDeviceId ("WATCHOS-<UUID>", <= 80 chars)
        if let savedDevId = defaults.string(forKey: deviceIdPrefsKey),
           !savedDevId.isEmpty,
           savedDevId.count <= 80 {
            watchDeviceId = savedDevId
        } else {
            let generated = "WATCHOS-" + UUID().uuidString
            watchDeviceId = String(generated.prefix(80))
            defaults.set(watchDeviceId, forKey: deviceIdPrefsKey)
        }

        // 2. Persisted sequence counter & FIFO command queue
        cmdSequence = Int64(max(0, defaults.integer(forKey: cmdSeqPrefsKey)))
        loadPersistedCloudCmdQueue()

        // 3. IMU auto-detect & athlete profile settings
        autoDetectEnabled = defaults.bool(forKey: "autoDetectEnabled_v2")
        if defaults.object(forKey: "sensitivityLevel") != nil {
            sensitivityLevel = max(0, min(2, defaults.integer(forKey: "sensitivityLevel")))
        }
        let savedWeight = defaults.double(forKey: weightKgPrefsKey)
        if savedWeight >= 25.0 && savedWeight <= 250.0 {
            athleteWeightKg = savedWeight
        }
        if let savedPt = defaults.string(forKey: practiceTypePrefsKey), !savedPt.isEmpty {
            practiceTypeStr = savedPt
        }

        currentSessionId = defaults.string(forKey: "currentSessionId") ?? ""

        // 4. Persisted 6-digit pairingCode & 256-bit cloudSessionToken
        if let savedCode = defaults.string(forKey: pairingCodePrefsKey), Self.isValidPairingCode(savedCode) {
            pairingCode = savedCode
            hasPairingCode = true
            parsePairingDigits(savedCode)
        }
        if let savedToken = defaults.string(forKey: sessionTokenPrefsKey), Self.isValidSessionToken(savedToken) {
            cloudSessionToken = savedToken
        }

        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }

        restartPedometerFromNow()
        syncShotDetectionMotionSensors()
        if !currentSessionId.isEmpty || arrowCount > 0 || analysisMode {
            startHeartRateStreamingIfSupported()
        }

        if hasPairingCode {
            if !cloudSessionToken.isEmpty {
                pollFirestoreCloud()
                processPendingCloudCmdQueue()
            } else {
                claimPairingTokenIfNeeded()
            }
        }
        startCloudPollingTimer()
    }

    deinit {
        cloudPollTimer?.invalidate()
        manualTimer?.invalidate()
        stopHeartRateStreaming()
    }

    // MARK: - Validation Helpers

    private static func isValidPairingCode(_ code: String) -> Bool {
        guard code.count == 6 else { return false }
        let bytes = Array(code.utf8)
        guard bytes[0] >= 49 && bytes[0] <= 57 else { return false } // '1'..'9'
        for i in 1..<6 {
            if bytes[i] < 48 || bytes[i] > 57 { return false }
        }
        return true
    }

    private static func isValidSessionToken(_ token: String) -> Bool {
        let count = token.utf8.count
        guard count >= 32 && count <= 64 else { return false }
        for b in token.utf8 {
            let isUpper = (b >= 65 && b <= 90)
            let isLower = (b >= 97 && b <= 122)
            let isDigit = (b >= 48 && b <= 57)
            let isSafeSym = (b == 45 || b == 95) // '-' or '_'
            if !(isUpper || isLower || isDigit || isSafeSym) {
                return false
            }
        }
        return true
    }

    private func nextCmdSequence() -> Int64 {
        cmdSequence += 1
        if cmdSequence >= 999_999_000 {
            cmdSequence = 1
        }
        UserDefaults.standard.set(Int(truncatingIfNeeded: cmdSequence), forKey: cmdSeqPrefsKey)
        return cmdSequence
    }

    // MARK: - Session Lifecycle & Pedometer

    private func resetSessionCounters(newSessionId: String) {
        currentSessionId = newSessionId
        UserDefaults.standard.set(newSessionId, forKey: "currentSessionId")
        arrowCount = 0
        totalScore = 0
        currentEnd = 1
        currentEndArrows.removeAll()
        stepsCount = 0
        lastSyncedStepsCount = 0
        distanceWalkedM = 0.0
        syncedActiveKcal = 0
        avgHeartRateBpm = 0
        maxHeartRateBpm = 0
        hrSampleSum = 0
        hrSampleCount = 0
        seenHrSampleIds.removeAll()
        heartRateAnchor = nil
        lastAnalysisStabPct = 0
        scorepadHintText = ""
        imuLock.lock()
        accelCandidateStepT.removeAll()
        accelRhythmicCadenceActive = false
        imuLock.unlock()
        restartPedometerFromNow()
    }

    private func restartPedometerFromNow() {
        guard CMPedometer.isStepCountingAvailable() else { return }
        hasHardwarePedometer = true
        pedometer.stopUpdates()
        pedometer.startUpdates(from: Date()) { [weak self] data, _ in
            guard let self = self, let data = data else { return }
            DispatchQueue.main.async {
                let newSteps = max(0, data.numberOfSteps.intValue)
                if newSteps > self.stepsCount {
                    let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
                    self.recordDetectedStep(nowMs: nowMs)
                }
                self.stepsCount = newSteps
                let pedDist = data.distance?.doubleValue ?? (Double(self.stepsCount) * 0.78)
                self.distanceWalkedM = max(self.distanceWalkedM, pedDist, Double(self.stepsCount) * 0.78)
                self.maybeSyncTelemetryToPhone()
            }
        }
    }

    // MARK: - Biomechanical 100Hz IMU Pipeline (Dedicated Serial Background Queue)

    private func isTrueArcheryAnchorOnImuQueue(
        nowMs: Int64,
        windowMs: Int64,
        quietMeanG: Double,
        quietPeakG: Double,
        preRampG: Double,
        axisSpanG: Double,
        gyroMeanMax: Double,
        gyroPeakMax: Double
    ) -> Bool {
        let end = nowMs - 45
        let start = end - windowMs
        let recentStart = end - 220
        var n = 0
        var recentN = 0
        var gyroN = 0
        var oldest: Int64 = Int64.max
        var sumLin = 0.0
        var recentSumLin = 0.0
        var sumAx = 0.0, sumAy = 0.0, sumAz = 0.0
        var minAx = Double.greatestFiniteMagnitude, maxAx = -Double.greatestFiniteMagnitude
        var minAy = Double.greatestFiniteMagnitude, maxAy = -Double.greatestFiniteMagnitude
        var minAz = Double.greatestFiniteMagnitude, maxAz = -Double.greatestFiniteMagnitude
        var sumGyro = 0.0

        imuLock.lock()
        let snapshot = motionBuf
        imuLock.unlock()

        for s in snapshot.reversed() {
            if s.t < start { break }
            if s.t > end { continue }
            if s.linG > quietPeakG { return false }
            if s.gyroRad >= 0 && s.gyroRad > gyroPeakMax { return false }
            sumLin += s.linG
            if s.t >= recentStart {
                recentSumLin += s.linG
                recentN += 1
            }
            sumAx += s.ax; sumAy += s.ay; sumAz += s.az
            if s.ax < minAx { minAx = s.ax }; if s.ax > maxAx { maxAx = s.ax }
            if s.ay < minAy { minAy = s.ay }; if s.ay > maxAy { maxAy = s.ay }
            if s.az < minAz { minAz = s.az }; if s.az > maxAz { maxAz = s.az }
            if s.gyroRad >= 0 {
                sumGyro += s.gyroRad
                gyroN += 1
            }
            n += 1
            oldest = s.t
        }

        guard n >= 16, oldest != Int64.max, Double(end - oldest) >= Double(windowMs) * 0.85 else { return false }
        guard (sumLin / Double(n)) <= quietMeanG else { return false }
        if recentN >= 3 && (recentSumLin / Double(recentN)) > preRampG { return false }

        let meanAx = sumAx / Double(n)
        let meanAy = sumAy / Double(n)
        let meanAz = sumAz / Double(n)
        let gNorm = sqrt(meanAx * meanAx + meanAy * meanAy + meanAz * meanAz)
        guard gNorm >= 0.84 && gNorm <= 1.16 else { return false }
        let forearmVert = abs(meanAx) / gNorm
        let perpG = sqrt(meanAy * meanAy + meanAz * meanAz)
        guard forearmVert <= 0.68 && perpG >= 0.69 else { return false }
        guard (maxAx - minAx) <= axisSpanG && (maxAy - minAy) <= axisSpanG && (maxAz - minAz) <= axisSpanG else { return false }
        if gyroN >= 8 && (sumGyro / Double(gyroN)) > gyroMeanMax { return false }
        return true
    }

    private func recordDetectedStep(nowMs: Int64, stepDelta: Int = 1) {
        if (nowMs - lastStepTimeMs) > 9000 {
            recentStepBoutCount = 0
        }
        recentStepBoutCount += max(1, stepDelta)
        prevStepTimeMs = lastStepTimeMs
        lastStepTimeMs = nowMs
        pendingShotActive = false
        let lockDuration: Int64 = (recentStepBoutCount >= 4) ? 9000 : 4800
        walkingLockUntilMs = max(walkingLockUntilMs, nowMs + lockDuration)
        if !isWalkingPaused {
            isWalkingPaused = true
        }
    }

    private func evaluateFallbackRhythmicStepOnImuQueue(nowMs: Int64) -> Int {
        if let last = accelCandidateStepT.last, (nowMs - last) > 2200 {
            accelCandidateStepT.removeAll()
            accelRhythmicCadenceActive = false
        }
        accelCandidateStepT.append(nowMs)
        if accelCandidateStepT.count > 4 {
            accelCandidateStepT.removeFirst()
        }
        guard accelCandidateStepT.count >= 4 else { return 0 }
        let g1 = Double(accelCandidateStepT[1] - accelCandidateStepT[0])
        let g2 = Double(accelCandidateStepT[2] - accelCandidateStepT[1])
        let g3 = Double(accelCandidateStepT[3] - accelCandidateStepT[2])
        if g1 >= 320 && g1 <= 1350 && g2 >= 320 && g2 <= 1350 && g3 >= 320 && g3 <= 1350 {
            let avg = (g1 + g2 + g3) / 3.0
            let tol = avg * 0.28
            if abs(g1 - avg) <= tol && abs(g2 - avg) <= tol && abs(g3 - avg) <= tol {
                if !accelRhythmicCadenceActive {
                    accelRhythmicCadenceActive = true
                    return 4
                }
                return 1
            }
        }
        accelRhythmicCadenceActive = false
        return 0
    }

    func syncShotDetectionMotionSensors() {
        if analysisMode || autoDetectEnabled {
            startInertial100HzSensors()
            return
        }
        pendingShotActive = false
        if isWalkingPaused {
            isWalkingPaused = false
        }
        if motionManager.isGyroActive {
            motionManager.stopGyroUpdates()
        }
        if motionManager.isAccelerometerActive {
            motionManager.stopAccelerometerUpdates()
        }
        imuLock.lock()
        motionBuf.removeAll()
        imuLock.unlock()
    }

    private func startInertial100HzSensors() {
        guard autoDetectEnabled || analysisMode else { return }

        if motionManager.isGyroAvailable && !motionManager.isGyroActive {
            motionManager.gyroUpdateInterval = 0.01 // 100 Hz
            motionManager.startGyroUpdates(to: imuQueue) { [weak self] data, _ in
                guard let self = self, let rot = data?.rotationRate else { return }
                let rad = sqrt(rot.x * rot.x + rot.y * rot.y + rot.z * rot.z)
                let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
                self.imuLock.lock()
                self.latestGyroRad = rad
                self.lastGyroMs = nowMs
                self.imuLock.unlock()
            }
        }

        if motionManager.isAccelerometerAvailable && !motionManager.isAccelerometerActive {
            motionManager.accelerometerUpdateInterval = 0.01 // 100 Hz
            motionManager.startAccelerometerUpdates(to: imuQueue) { [weak self] data, _ in
                guard let self = self, let acc = data?.acceleration else { return }
                let magG = sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z)
                let dynamicG = magG - self.smoothedMagG
                self.smoothedMagG = (0.95 * self.smoothedMagG) + (0.05 * magG)
                let linearG = abs(magG - 1.0)
                let nowMs = Int64(Date().timeIntervalSince1970 * 1000)

                self.imuLock.lock()
                self.latestAccVec = [acc.x, acc.y, acc.z]
                let activeGyro = ((nowMs - self.lastGyroMs) <= 140) ? self.latestGyroRad : -1.0
                self.imuLock.unlock()

                let autoOn = self.autoDetectEnabled
                let sens = self.sensitivityLevel

                // Gait / bow-carry cadence lock
                let sigG = max(linearG, abs(dynamicG))
                var nextWalkingPausedChange: Bool? = nil
                if self.prevSigG >= 0.11 && self.prevSigG > self.prevPrevSigG && self.prevSigG >= sigG
                    && (self.peakTimesMs.last == nil || (nowMs - self.peakTimesMs.last!) >= 290) {
                    self.peakTimesMs.append(nowMs)
                    while let first = self.peakTimesMs.first, (nowMs - first) > 4500 {
                        self.peakTimesMs.removeFirst()
                    }
                    if self.peakTimesMs.count >= 3 {
                        let c = self.peakTimesMs.count
                        let g1 = Double(self.peakTimesMs[c - 1] - self.peakTimesMs[c - 2])
                        let g2 = Double(self.peakTimesMs[c - 2] - self.peakTimesMs[c - 3])
                        if g1 >= 290 && g1 <= 1450 && g2 >= 290 && g2 <= 1450 {
                            let avg2 = (g1 + g2) / 2.0
                            if abs(g1 - avg2) <= avg2 * 0.34 && abs(g2 - avg2) <= avg2 * 0.34 {
                                self.walkingLockUntilMs = max(self.walkingLockUntilMs, nowMs + 6500)
                                self.pendingShotActive = false
                                nextWalkingPausedChange = true
                            }
                        }
                    }
                }
                self.prevPrevSigG = self.prevSigG
                self.prevSigG = sigG

                if nowMs >= self.walkingLockUntilMs && nextWalkingPausedChange == nil && self.isWalkingPaused {
                    nextWalkingPausedChange = false
                }
                if let wp = nextWalkingPausedChange {
                    DispatchQueue.main.async { [weak self] in
                        if self?.isWalkingPaused != wp {
                            self?.isWalkingPaused = wp
                        }
                    }
                }

                // Fallback rhythmic step counter ONLY when hardware pedometer is unavailable
                if !self.hasHardwarePedometer
                    && dynamicG >= 0.14
                    && dynamicG <= 1.15
                    && (nowMs - self.lastStepTimeMs) > 380
                    && (nowMs - self.lastShotTimeMs) > 1500 {
                    let addedSteps = self.evaluateFallbackRhythmicStepOnImuQueue(nowMs: nowMs)
                    if addedSteps > 0 {
                        DispatchQueue.main.async { [weak self] in
                            guard let self = self else { return }
                            self.recordDetectedStep(nowMs: nowMs, stepDelta: addedSteps)
                            self.stepsCount += addedSteps
                            self.distanceWalkedM = max(self.distanceWalkedM, Double(self.stepsCount) * 0.76)
                            self.maybeSyncTelemetryToPhone()
                        }
                    }
                }

                let thresholdG = (sens == 0) ? 2.35 : ((sens == 2) ? 1.55 : 1.92)
                let minJerkG = (sens == 0) ? 1.38 : ((sens == 2) ? 0.94 : 1.14)
                let quietMeanG = (sens == 0) ? 0.053 : ((sens == 2) ? 0.082 : 0.066)
                let quietPeakG = (sens == 0) ? 0.112 : ((sens == 2) ? 0.158 : 0.132)
                let preRampG = (sens == 0) ? 0.051 : ((sens == 2) ? 0.078 : 0.063)
                let axisSpanG = (sens == 0) ? 0.158 : ((sens == 2) ? 0.224 : 0.188)
                let gyroMeanMax = (sens == 0) ? 0.25 : ((sens == 2) ? 0.40 : 0.32)
                let gyroPeakMax = (sens == 0) ? 0.65 : ((sens == 2) ? 0.95 : 0.78)
                let stillWindowMs: Int64 = (sens == 0) ? 1550 : ((sens == 2) ? 1050 : 1300)
                let cooldownMs: Int64 = (sens == 0) ? 7000 : ((sens == 2) ? 5000 : 6000)
                let isWalkingBlocked = (nowMs < self.walkingLockUntilMs) || ((nowMs - self.lastStepTimeMs) < 4800)

                if self.pendingShotActive {
                    if !autoOn || isWalkingBlocked {
                        self.pendingShotActive = false
                    } else {
                        let elapsed = nowMs - self.pendingShotStartMs
                        if elapsed >= 95 && elapsed <= 235 {
                            self.pendingFollowN += 1
                            self.pendingFollowSumLinG += linearG
                            self.pendingFollowSumAxG += acc.x
                            if activeGyro >= 0 {
                                self.pendingFollowSumGyro += activeGyro
                                self.pendingFollowGyroN += 1
                            }
                        }
                        if elapsed >= 220 {
                            self.pendingShotActive = false
                            var validFollow = self.pendingFollowN >= 2
                            if validFollow {
                                let meanFollowLin = self.pendingFollowSumLinG / Double(self.pendingFollowN)
                                let meanFollowAx = abs(self.pendingFollowSumAxG / Double(self.pendingFollowN))
                                let meanFollowGyro = self.pendingFollowGyroN >= 2
                                    ? (self.pendingFollowSumGyro / Double(self.pendingFollowGyroN))
                                    : 0.0
                                if meanFollowLin > 0.80 || meanFollowAx > 0.82 || meanFollowGyro > 4.2 {
                                    validFollow = false
                                }
                            }
                            // 100% IMU Biomechanical Shot Gate (Zero Microphone Recording)
                            if validFollow && (nowMs - self.lastShotTimeMs) > cooldownMs {
                                let trigMs = self.pendingShotStartMs
                                self.lastShotTimeMs = nowMs
                                DispatchQueue.main.async { [weak self] in
                                    guard let self = self else { return }
                                    if self.analysisMode && !self.manualAnalysisRecording {
                                        WKInterfaceDevice.current().play(.stop)
                                        self.finalizeAnalysisWindow(
                                            startMs: trigMs - 9_500,
                                            endMs: nowMs,
                                            notifyPhoneStopFallback: false,
                                            isAutoShot: true
                                        )
                                    } else if !self.analysisMode {
                                        self.incrementArrow(delta: 1, source: "watch_auto")
                                    }
                                }
                            }
                        }
                    }
                } else if autoOn
                    && !isWalkingBlocked
                    && linearG >= thresholdG
                    && (nowMs - self.lastShotTimeMs) > cooldownMs {
                    var maxJump = 0.0
                    self.imuLock.lock()
                    let cnt = self.motionBuf.count
                    if cnt > 0 {
                        for k in 1...3 where cnt - k >= 0 {
                            maxJump = max(maxJump, abs(magG - self.motionBuf[cnt - k].magG))
                        }
                    }
                    self.imuLock.unlock()

                    if maxJump >= minJerkG && self.isTrueArcheryAnchorOnImuQueue(
                        nowMs: nowMs,
                        windowMs: stillWindowMs,
                        quietMeanG: quietMeanG,
                        quietPeakG: quietPeakG,
                        preRampG: preRampG,
                        axisSpanG: axisSpanG,
                        gyroMeanMax: gyroMeanMax,
                        gyroPeakMax: gyroPeakMax
                    ) {
                        self.pendingShotActive = true
                        self.pendingShotStartMs = nowMs
                        self.pendingFollowN = 0
                        self.pendingFollowSumLinG = 0.0
                        self.pendingFollowSumAxG = 0.0
                        self.pendingFollowSumGyro = 0.0
                        self.pendingFollowGyroN = 0
                    }
                }

                let sample = MotionSample(
                    t: nowMs,
                    ax: acc.x,
                    ay: acc.y,
                    az: acc.z,
                    magG: magG,
                    linG: linearG,
                    gyroRad: activeGyro
                )
                self.imuLock.lock()
                self.motionBuf.append(sample)
                if self.motionBuf.count > 3000 {
                    self.motionBuf.removeFirst(self.motionBuf.count - 3000)
                }
                self.imuLock.unlock()
            }
        }
    }

    private func calibrateZeroReference(notifyPhone: Bool) {
        if !motionManager.isAccelerometerActive {
            startInertial100HzSensors()
        }
        imuLock.lock()
        let vec = latestAccVec
        imuLock.unlock()
        let roundedVec = vec.map { ($0 * 1000.0).rounded() / 1000.0 }
        calibratedZeroVec = roundedVec
        WKInterfaceDevice.current().play(.click)
        if notifyPhone {
            sendCommandToPhone([
                "type": "ANALYSIS_ZERO_VECTOR",
                "zeroGravityVec": roundedVec
            ])
        }
    }

    // MARK: - HealthKit Workout Session, Builder & Deduplicated Anchored HR Query (AUD-WATCH-05)

    func startHeartRateStreamingIfSupported() {
        guard HKHealthStore.isHealthDataAvailable(),
              let hrType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            hrSensorStatus = "unavailable"
            sendHeartRateStatusToPhone(bpm: 0, status: "no_sensor")
            return
        }

        // If already running with an active query, do not recreate query from nil anchor!
        if let ws = workoutSession, ws.state == .running, heartRateQuery != nil {
            if heartRateBpm >= 30 {
                sendHeartRateStatusToPhone(bpm: heartRateBpm, status: "ok")
            }
            return
        }

        let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
        let readTypes: Set<HKObjectType> = [hrType]
        healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { [weak self] granted, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                let workoutAuth = self.healthStore.authorizationStatus(for: HKObjectType.workoutType())
                guard granted && workoutAuth != .sharingDenied else {
                    self.hrSensorStatus = "permission_denied"
                    self.sendHeartRateStatusToPhone(bpm: 0, status: "permission_denied")
                    return
                }
                self.beginWorkoutAndHeartRateQuery(hrType: hrType)
            }
        }
    }

    private func beginWorkoutAndHeartRateQuery(hrType: HKQuantityType) {
        let startDate = Date()
        if workoutSession == nil || workoutSession?.state == .ended {
            let config = HKWorkoutConfiguration()
            config.activityType = .archery
            config.locationType = .outdoor
            if let session = try? HKWorkoutSession(healthStore: healthStore, configuration: config) {
                let builder = session.associatedWorkoutBuilder()
                builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
                session.delegate = self
                builder.delegate = self
                workoutSession = session
                workoutBuilder = builder
                session.prepare()
                session.startActivity(with: startDate)
                builder.beginCollection(withStart: startDate) { _, _ in }
            }
        }

        if heartRateQuery == nil {
            let predicate: NSPredicate? = (heartRateAnchor == nil)
                ? HKQuery.predicateForSamples(withStart: startDate.addingTimeInterval(-15), end: nil, options: .strictStartDate)
                : nil
            let query = HKAnchoredObjectQuery(
                type: hrType,
                predicate: predicate,
                anchor: heartRateAnchor,
                limit: HKObjectQueryNoLimit
            ) { [weak self] _, samples, _, newAnchor, _ in
                self?.handleHeartRateSamples(samples, newAnchor: newAnchor)
            }
            query.updateHandler = { [weak self] _, samples, _, newAnchor, _ in
                self?.handleHeartRateSamples(samples, newAnchor: newAnchor)
            }
            heartRateQuery = query
            hrSensorStatus = "connecting"
            healthStore.execute(query)
            armHeartRateSampleWatchdog()
        }
    }

    private func armHeartRateSampleWatchdog() {
        hrSampleWatchdogWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            if self.lastHrSampleReceivedMs == 0 && self.heartRateQuery != nil {
                // HealthKit masks read-permission denial as 0 samples; surface clear status
                self.hrSensorStatus = "no_samples"
                self.sendHeartRateStatusToPhone(bpm: 0, status: "permission_denied")
            }
        }
        hrSampleWatchdogWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 15.0, execute: work)
    }

    func stopHeartRateStreaming() {
        hrSampleWatchdogWorkItem?.cancel()
        hrSampleWatchdogWorkItem = nil

        if let q = heartRateQuery {
            healthStore.stop(q)
            heartRateQuery = nil
        }

        let endDate = Date()
        let activeBuilder = workoutBuilder
        let activeSession = workoutSession
        workoutBuilder = nil
        workoutSession = nil

        if let ws = activeSession, ws.state != .ended {
            ws.end()
        }
        if let builder = activeBuilder {
            builder.endCollection(withEnd: endDate) { _, _ in
                builder.finishWorkout { _, _ in }
            }
        }
        hrSensorStatus = "idle"
    }

    // MARK: - HKWorkoutSessionDelegate & HKLiveWorkoutBuilderDelegate

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if toState == .ended {
                self.hrSensorStatus = "idle"
            } else if toState == .running && self.hrSensorStatus == "idle" {
                self.hrSensorStatus = "streaming"
            }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.hrSensorStatus = "unavailable"
            self?.sendHeartRateStatusToPhone(bpm: 0, status: "no_sensor")
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {}

    private func handleHeartRateSamples(_ samples: [HKSample]?, newAnchor: HKQueryAnchor?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let anchor = newAnchor {
                self.heartRateAnchor = anchor
            }
            guard let quantitySamples = samples as? [HKQuantitySample], !quantitySamples.isEmpty else { return }

            let bpmUnit = HKUnit.count().unitDivided(by: HKUnit.minute())
            var latestValidBpm = 0

            for sample in quantitySamples {
                let bpm = Int(round(sample.quantity.doubleValue(for: bpmUnit)))
                guard bpm >= 30 && bpm <= 245 else { continue }
                latestValidBpm = bpm

                if !self.seenHrSampleIds.contains(sample.uuid) {
                    self.seenHrSampleIds.append(sample.uuid)
                    if self.seenHrSampleIds.count > 250 {
                        self.seenHrSampleIds.removeFirst(self.seenHrSampleIds.count - 250)
                    }
                    self.hrSampleSum += bpm
                    self.hrSampleCount += 1
                    if bpm > self.maxHeartRateBpm {
                        self.maxHeartRateBpm = bpm
                    }
                }
            }

            guard latestValidBpm >= 30 else { return }
            let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
            self.lastHrSampleReceivedMs = nowMs
            self.hrSensorStatus = "streaming"
            self.heartRateBpm = latestValidBpm
            if self.hrSampleCount > 0 {
                self.avgHeartRateBpm = Int(round(Double(self.hrSampleSum) / Double(self.hrSampleCount)))
            }

            if (nowMs - self.lastHrPhoneSendMs) >= 1_000 {
                self.lastHrPhoneSendMs = nowMs
                self.sendHeartRateStatusToPhone(bpm: latestValidBpm, status: "ok")
            }
            if !self.cloudSessionToken.isEmpty && (nowMs - self.lastHrCloudPushMs) >= 5_000 {
                self.lastHrCloudPushMs = nowMs
                self.enqueueCloudWatchCommand(eventType: "SYNC_TELEMETRY_FROM_WATCH", extraValue: nil)
            }
        }
    }

    private func sendHeartRateStatusToPhone(bpm: Int, status: String) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        var msg: [String: Any] = [
            "type": "HR",
            "bpm": bpm,
            "status": status,
            "deviceName": "Smartwatch Deportivo",
            "_ts": nowMs
        ]
        if avgHeartRateBpm >= 30 { msg["avgHeartRateBpm"] = avgHeartRateBpm }
        if maxHeartRateBpm >= 30 { msg["maxHeartRateBpm"] = maxHeartRateBpm }
        session.sendMessage(msg, replyHandler: nil, errorHandler: nil)
    }

    // MARK: - Computed Biometrics (Using Synced athleteWeightKg)

    var walkedMetersInt: Int {
        max(0, Int(round(max(distanceWalkedM, Double(stepsCount) * 0.76))))
    }

    var walkedFeetInt: Int {
        max(0, Int(round(Double(walkedMetersInt) * 3.28084)))
    }

    var walkedMetricString: String {
        if walkedMetersInt >= 1000 {
            return String(format: "%.2f km", Double(walkedMetersInt) / 1000.0)
        }
        return "\(walkedMetersInt) m"
    }

    var walkedImperialString: String {
        let miles = Double(walkedMetersInt) / 1609.344
        if miles >= 0.1 {
            return String(format: "%.2f mi", miles)
        }
        return "\(walkedFeetInt) ft"
    }

    var walkedPrimaryString: String {
        isImperial ? walkedImperialString : walkedMetricString
    }

    var walkedDualString: String {
        isImperial
            ? "\(walkedImperialString) · \(walkedMetricString)"
            : "\(walkedMetricString) · \(walkedImperialString)"
    }

    var activeKcal: Int {
        if arrowCount <= 0 && walkedMetersInt < 10 {
            return max(0, syncedActiveKcal)
        }
        let effectiveWeightKg = (athleteWeightKg >= 25.0 && athleteWeightKg <= 250.0) ? athleteWeightKg : 72.0
        let kcalPerArrow = 0.56 + (max(15.0, bowPoundageLbs) * 0.0165)
        let walkKcal = (Double(walkedMetersInt) / 1000.0) * effectiveWeightKg * 0.78
        return max(0, Int(round(Double(arrowCount) * kcalPerArrow + walkKcal)))
    }

    var currentStatusPillLabel: String {
        let syncedNow = isPhoneConnected || isCloudSynced
        if syncedNow {
            return tr("CONECTADO · LIVE", "SYNCED · LIVE")
        }
        if pendingQueueCount > 0 {
            return tr("COLA OFFLINE (\(pendingQueueCount))", "QUEUED (\(pendingQueueCount))")
        }
        return tr("MODO LOCAL", "LOCAL MODE")
    }

    private func maybeSyncTelemetryToPhone(force: Bool = false) {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let stepDelta = stepsCount - lastSyncedStepsCount
        if !force && (stepDelta < 2 || (nowMs - lastTelemetrySyncTimeMs) < 2000) {
            return
        }
        lastSyncedStepsCount = stepsCount
        lastTelemetrySyncTimeMs = nowMs
        let walked = walkedMetersInt
        let kcal = activeKcal
        var payloadDict: [String: Any] = [
            "stepsCount": stepsCount,
            "distanceWalkedM": walked,
            "activeKcal": kcal
        ]
        var cmdDict: [String: Any] = [
            "type": "SYNC_TELEMETRY_FROM_WATCH",
            "stepsCount": stepsCount,
            "distanceWalkedM": walked,
            "activeKcal": kcal
        ]
        if heartRateBpm >= 30 && heartRateBpm <= 245 {
            payloadDict["heartRateBpm"] = heartRateBpm
            cmdDict["heartRateBpm"] = heartRateBpm
        }
        if avgHeartRateBpm >= 30 && avgHeartRateBpm <= 245 {
            payloadDict["avgHeartRateBpm"] = avgHeartRateBpm
            cmdDict["avgHeartRateBpm"] = avgHeartRateBpm
        }
        if maxHeartRateBpm >= 30 && maxHeartRateBpm <= 245 {
            payloadDict["maxHeartRateBpm"] = maxHeartRateBpm
            cmdDict["maxHeartRateBpm"] = maxHeartRateBpm
        }
        cmdDict["payload"] = payloadDict
        sendCommandToPhone(cmdDict)
    }

    // MARK: - 6-Digit Pairing UI & 256-Bit Token Handshake (AUD-FB-01, AUD-WATCH-03, AUD-WATCH-07)

    func parsePairingDigits(_ code: String) {
        let chars = Array(code)
        guard chars.count == 6 else { return }
        for i in 0..<6 {
            var d = Int(String(chars[i])) ?? ((i == 0) ? 1 : 0)
            if d < 0 || d > 9 { d = (i == 0) ? 1 : 0 }
            if i == 0 && d == 0 { d = 1 }
            pairingDigits[i] = d
        }
    }

    func adjustSelectedCodeDigit(delta: Int) {
        guard delta != 0 else { return }
        let step = delta > 0 ? 1 : -1
        let cur = pairingDigits[editDigitPos]
        if editDigitPos == 0 {
            var nextFirst = cur + step
            if nextFirst > 9 { nextFirst = 1 }
            if nextFirst < 1 { nextFirst = 9 }
            pairingDigits[0] = nextFirst
        } else {
            pairingDigits[editDigitPos] = (cur + step + 10) % 10
        }
        isEditingCode = true
        cloudStatusMessage = ""
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.click)
    }

    func commitPairingDigits() {
        let built = pairingDigits.map { String($0) }.joined()
        guard Self.isValidPairingCode(built) else {
            cloudStatusMessage = tr("CÓDIGO INVÁLIDO", "INVALID CODE")
            return
        }
        let codeChanged = (built != pairingCode)
        pairingCode = built
        hasPairingCode = true
        isEditingCode = false
        pairingTerminalError = false
        cloudStatusMessage = ""
        lastRemoteStateSig = ""
        if codeChanged {
            clearCloudSessionToken()
        }
        markUserActivity(isWriteAction: true)
        UserDefaults.standard.set(built, forKey: pairingCodePrefsKey)
        WKInterfaceDevice.current().play(.success)

        if cloudSessionToken.isEmpty {
            claimPairingTokenIfNeeded()
        } else {
            pollFirestoreCloud()
            enqueueCloudWatchCommand(eventType: "SYNC_TELEMETRY_FROM_WATCH", extraValue: nil)
        }
        scheduleNextCloudPoll()
    }

    func unlinkCloudSession() {
        hasPairingCode = false
        pairingCode = ""
        isEditingCode = false
        pairingTerminalError = false
        isCloudSynced = false
        cloudStatusMessage = ""
        clearCloudSessionToken()
        UserDefaults.standard.removeObject(forKey: pairingCodePrefsKey)
        WKInterfaceDevice.current().play(.click)
    }

    private func saveCloudSessionToken(_ token: String) {
        guard Self.isValidSessionToken(token) else { return }
        cloudSessionToken = token
        pairingTerminalError = false
        UserDefaults.standard.set(token, forKey: sessionTokenPrefsKey)
    }

    private func clearCloudSessionToken() {
        cloudSessionToken = ""
        UserDefaults.standard.removeObject(forKey: sessionTokenPrefsKey)
    }

    func claimPairingTokenIfNeeded() {
        guard hasPairingCode,
              Self.isValidPairingCode(pairingCode),
              cloudSessionToken.isEmpty,
              !isClaimingPairing,
              !pairingTerminalError else { return }

        let targetCode = pairingCode
        guard let getUrl = URL(string: "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_pairings/\(targetCode)") else {
            return
        }

        isClaimingPairing = true
        var getReq = URLRequest(url: getUrl)
        getReq.httpMethod = "GET"
        getReq.cachePolicy = .reloadIgnoringLocalCacheData

        cloudUrlSession.dataTask(with: getReq) { [weak self] data, resp, err in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard let http = resp as? HTTPURLResponse else {
                    self.isClaimingPairing = false
                    if err != nil {
                        self.cloudStatusMessage = self.tr("SIN CONEXIÓN", "OFFLINE")
                    }
                    return
                }

                if http.statusCode == 403 || http.statusCode == 404 {
                    self.isClaimingPairing = false
                    self.isCloudSynced = false
                    self.pairingTerminalError = true
                    self.cloudStatusMessage = (http.statusCode == 404)
                        ? self.tr("CÓDIGO INVÁLIDO", "INVALID CODE")
                        : self.tr("CÓDIGO EXPIRADO", "CODE EXPIRED")
                    return
                }

                guard http.statusCode == 200,
                      let data = data,
                      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let fields = root["fields"] as? [String: Any],
                      let tokNode = fields["sessionToken"] as? [String: Any],
                      let candidateToken = tokNode["stringValue"] as? String,
                      Self.isValidSessionToken(candidateToken) else {
                    self.isClaimingPairing = false
                    self.isCloudSynced = false
                    self.pairingTerminalError = true
                    self.cloudStatusMessage = self.tr("CÓDIGO INVÁLIDO", "INVALID CODE")
                    return
                }

                self.executeSingleUsePairingClaim(pairingCode: targetCode, sessionToken: candidateToken)
            }
        }.resume()
    }

    private func executeSingleUsePairingClaim(pairingCode: String, sessionToken: String) {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let claimUrlStr = "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_pairings/\(pairingCode)?updateMask.fieldPaths=claimed&updateMask.fieldPaths=watchDeviceId&updateMask.fieldPaths=watchSource&updateMask.fieldPaths=updatedAt&currentDocument.exists=true"
        let claimFields: [String: Any] = [
            "claimed": ["booleanValue": true],
            "watchDeviceId": ["stringValue": watchDeviceId],
            "watchSource": ["stringValue": "WATCHOS"],
            "updatedAt": ["integerValue": "\(nowMs)"]
        ]
        guard let url = URL(string: claimUrlStr),
              let body = try? JSONSerialization.data(withJSONObject: ["fields": claimFields]) else {
            isClaimingPairing = false
            return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("PATCH", forHTTPHeaderField: "X-HTTP-Method-Override")
        req.httpBody = body

        cloudUrlSession.dataTask(with: req) { [weak self] _, resp, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.isClaimingPairing = false
                guard let http = resp as? HTTPURLResponse else {
                    self.cloudStatusMessage = self.tr("SIN CONEXIÓN", "OFFLINE")
                    return
                }
                if (200..<300).contains(http.statusCode) {
                    self.saveCloudSessionToken(sessionToken)
                    self.isCloudSynced = true
                    self.cloudStatusMessage = ""
                    self.enqueueCloudWatchCommand(eventType: "SYNC_TELEMETRY_FROM_WATCH", extraValue: nil)
                    self.pollFirestoreCloud()
                    self.processPendingCloudCmdQueue()
                } else if http.statusCode == 403 || http.statusCode == 404 {
                    self.isCloudSynced = false
                    self.pairingTerminalError = true
                    self.cloudStatusMessage = (http.statusCode == 404)
                        ? self.tr("CÓDIGO INVÁLIDO", "INVALID CODE")
                        : self.tr("CÓDIGO EXPIRADO", "CODE EXPIRED")
                }
            }
        }.resume()
    }

    // MARK: - Persistent Serial FIFO Cloud Command Queue (AUD-WATCH-03)

    private func loadPersistedCloudCmdQueue() {
        guard let rawData = UserDefaults.standard.data(forKey: fifoQueuePrefsKey),
              let decoded = try? JSONDecoder().decode([QueuedCloudWatchCommand].self, from: rawData) else {
            pendingCloudCmdQueue = []
            pendingQueueCount = 0
            return
        }
        pendingCloudCmdQueue = Array(decoded.suffix(maxCloudQueueSize))
        pendingQueueCount = pendingCloudCmdQueue.count
    }

    private func persistCloudCmdQueue() {
        pendingQueueCount = pendingCloudCmdQueue.count
        if pendingCloudCmdQueue.isEmpty {
            UserDefaults.standard.removeObject(forKey: fifoQueuePrefsKey)
            return
        }
        if let data = try? JSONEncoder().encode(pendingCloudCmdQueue) {
            UserDefaults.standard.set(data, forKey: fifoQueuePrefsKey)
        }
    }

    private func enqueueCloudWatchCommand(
        eventType: String,
        extraValue: String?,
        explicitDelta: Int? = nil,
        explicitCalibrateAt: Int64? = nil,
        explicitZeroVec: [Double]? = nil
    ) {
        guard hasPairingCode || !cloudSessionToken.isEmpty else { return }
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let seq = nextCmdSequence()
        let cmdId = "wos-\(nowMs)-\(seq)"

        let safeExtra: String?
        if eventType == "ANALYSIS_SHOT", let rawShot = extraValue {
            safeExtra = String(rawShot.prefix(3500))
        } else {
            safeExtra = extraValue
        }

        let item = QueuedCloudWatchCommand(
            cmdId: cmdId,
            cmdSeq: seq,
            createdAtMs: nowMs,
            eventType: eventType,
            extraValue: safeExtra,
            delta: explicitDelta,
            totalScore: max(0, min(100_000, totalScore)),
            stepsCount: max(0, min(1_000_000, stepsCount)),
            distanceWalkedM: max(0, min(1_000_000, walkedMetersInt)),
            activeKcal: max(0, min(100_000, activeKcal)),
            heartRateBpm: (heartRateBpm >= 30 && heartRateBpm <= 245) ? heartRateBpm : 0,
            avgHeartRateBpm: (avgHeartRateBpm >= 30 && avgHeartRateBpm <= 245) ? avgHeartRateBpm : 0,
            maxHeartRateBpm: (maxHeartRateBpm >= 30 && maxHeartRateBpm <= 245) ? maxHeartRateBpm : 0,
            enabled: (eventType == "TOGGLE_AUTO_DETECT") ? autoDetectEnabled : nil,
            sensitivityLevel: (eventType == "TOGGLE_AUTO_DETECT" || eventType == "SET_SENSITIVITY") ? sensitivityLevel : nil,
            calibrateZeroAt: explicitCalibrateAt,
            zeroGravityVec: explicitZeroVec
        )

        // Coalesce back-to-back pure telemetry items while preserving every shot/score/end/finish command strictly in FIFO order
        if eventType == "SYNC_TELEMETRY_FROM_WATCH",
           let lastIdx = pendingCloudCmdQueue.indices.last,
           !(lastIdx == 0 && isSendingCloudCmd),
           pendingCloudCmdQueue[lastIdx].eventType == "SYNC_TELEMETRY_FROM_WATCH" {
            pendingCloudCmdQueue[lastIdx] = item
        } else {
            if pendingCloudCmdQueue.count >= maxCloudQueueSize {
                pendingCloudCmdQueue.removeFirst()
            }
            pendingCloudCmdQueue.append(item)
        }
        persistCloudCmdQueue()
        processPendingCloudCmdQueue()
    }

    private func processPendingCloudCmdQueue() {
        guard !isSendingCloudCmd, let head = pendingCloudCmdQueue.first else { return }
        if cloudSessionToken.isEmpty {
            if hasPairingCode && !pairingTerminalError {
                claimPairingTokenIfNeeded()
            }
            return
        }
        guard Self.isValidSessionToken(cloudSessionToken) else {
            clearCloudSessionToken()
            return
        }

        isSendingCloudCmd = true
        let activeToken = cloudSessionToken
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)

        var cmdFields: [String: Any] = [
            "type": ["stringValue": String(head.eventType.prefix(40))],
            "cmdId": ["stringValue": head.cmdId],
            "_cmdId": ["stringValue": head.cmdId],
            "_ts": ["integerValue": "\(head.createdAtMs)"]
        ]

        switch head.eventType {
        case "INCREMENT_ARROW":
            cmdFields["delta"] = ["integerValue": "\(head.delta ?? 1)"]
            cmdFields["source"] = ["stringValue": String((head.extraValue ?? "watch_manual").prefix(32))]
            if head.heartRateBpm >= 30 {
                cmdFields["heartRateBpm"] = ["integerValue": "\(head.heartRateBpm)"]
            }
        case "DECREMENT_ARROW":
            cmdFields["delta"] = ["integerValue": "\(head.delta ?? -1)"]
            cmdFields["source"] = ["stringValue": "watch_manual"]
            cmdFields["totalScore"] = ["integerValue": "\(head.totalScore)"]
        case "SCORE_INPUT":
            if let val = head.extraValue {
                cmdFields["value"] = ["stringValue": String(val.prefix(12))]
            }
            cmdFields["totalScore"] = ["integerValue": "\(head.totalScore)"]
        case "UNDO_ARROW":
            cmdFields["totalScore"] = ["integerValue": "\(head.totalScore)"]
        case "TOGGLE_AUTO_DETECT":
            cmdFields["enabled"] = ["booleanValue": head.enabled ?? false]
            cmdFields["sensitivityLevel"] = ["integerValue": "\(head.sensitivityLevel ?? 1)"]
        case "SET_SENSITIVITY":
            cmdFields["sensitivityLevel"] = ["integerValue": "\(head.sensitivityLevel ?? 1)"]
        case "ANALYSIS_MANUAL_START", "ANALYSIS_MANUAL_STOP":
            cmdFields["ts"] = ["integerValue": "\(head.createdAtMs)"]
            cmdFields["source"] = ["stringValue": "watch_manual"]
        case "ANALYSIS_SHOT":
            if let shotJson = head.extraValue {
                cmdFields["analysisShotJson"] = ["stringValue": String(shotJson.prefix(3500))]
            }
            if head.heartRateBpm >= 30 {
                cmdFields["heartRateBpm"] = ["integerValue": "\(head.heartRateBpm)"]
            }
        case "ANALYSIS_ZERO_VECTOR":
            if let vec = head.zeroGravityVec, vec.count == 3,
               let vecData = try? JSONSerialization.data(withJSONObject: vec),
               let vecJson = String(data: vecData, encoding: .utf8) {
                cmdFields["analysisShotJson"] = ["stringValue": String(vecJson.prefix(240))]
            }
        case "SYNC_TELEMETRY_FROM_WATCH":
            cmdFields["stepsCount"] = ["integerValue": "\(head.stepsCount)"]
            cmdFields["distanceWalkedM"] = ["integerValue": "\(head.distanceWalkedM)"]
            cmdFields["activeKcal"] = ["integerValue": "\(head.activeKcal)"]
            if head.heartRateBpm >= 30 {
                cmdFields["heartRateBpm"] = ["integerValue": "\(head.heartRateBpm)"]
            }
            if head.avgHeartRateBpm >= 30 {
                cmdFields["avgHeartRateBpm"] = ["integerValue": "\(head.avgHeartRateBpm)"]
            }
            if head.maxHeartRateBpm >= 30 {
                cmdFields["maxHeartRateBpm"] = ["integerValue": "\(head.maxHeartRateBpm)"]
            }
        default:
            break
        }

        // Strict isValidWatchTelemetryUpdate whitelist
        var docFields: [String: Any] = [
            "lastWatchCmd": ["mapValue": ["fields": cmdFields]],
            "lastWatchCmdId": ["stringValue": head.cmdId],
            "lastWatchCmdSeq": ["integerValue": "\(head.cmdSeq)"],
            "watchStepsCount": ["integerValue": "\(head.stepsCount)"],
            "watchDistanceM": ["integerValue": "\(head.distanceWalkedM)"],
            "watchCaloriesKcal": ["integerValue": "\(head.activeKcal)"],
            "watchHeartbeatAt": ["integerValue": "\(nowMs)"],
            "watchSource": ["stringValue": "WATCHOS"],
            "watchDeviceId": ["stringValue": watchDeviceId],
            "updatedAt": ["integerValue": "\(nowMs)"]
        ]
        var maskPaths = [
            "lastWatchCmd", "lastWatchCmdId", "lastWatchCmdSeq",
            "watchStepsCount", "watchDistanceM", "watchCaloriesKcal",
            "watchHeartbeatAt", "watchSource", "watchDeviceId", "updatedAt"
        ]

        if head.heartRateBpm >= 30 && head.heartRateBpm <= 245 {
            docFields["watchHeartRateBpm"] = ["integerValue": "\(head.heartRateBpm)"]
            maskPaths.append("watchHeartRateBpm")
        }
        if head.avgHeartRateBpm >= 30 && head.avgHeartRateBpm <= 245 {
            docFields["watchAvgHeartRateBpm"] = ["integerValue": "\(head.avgHeartRateBpm)"]
            maskPaths.append("watchAvgHeartRateBpm")
        }
        if head.maxHeartRateBpm >= 30 && head.maxHeartRateBpm <= 245 {
            docFields["watchMaxHeartRateBpm"] = ["integerValue": "\(head.maxHeartRateBpm)"]
            maskPaths.append("watchMaxHeartRateBpm")
        }
        if let calAt = head.calibrateZeroAt, calAt > 0 {
            docFields["calibrateZeroAt"] = ["integerValue": "\(calAt)"]
            maskPaths.append("calibrateZeroAt")
        }
        if let zeroVec = head.zeroGravityVec, zeroVec.count == 3 {
            docFields["zeroGravityVec"] = [
                "arrayValue": [
                    "values": zeroVec.map { ["doubleValue": max(-100_000.0, min(100_000.0, $0))] }
                ]
            ]
            maskPaths.append("zeroGravityVec")
        }

        let maskQuery = maskPaths.map { "updateMask.fieldPaths=\($0)" }.joined(separator: "&")
        let urlStr = "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/\(activeToken)?\(maskQuery)&currentDocument.exists=true"
        guard let url = URL(string: urlStr),
              let body = try? JSONSerialization.data(withJSONObject: ["fields": docFields]) else {
            isSendingCloudCmd = false
            return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("PATCH", forHTTPHeaderField: "X-HTTP-Method-Override")
        req.httpBody = body

        cloudUrlSession.dataTask(with: req) { [weak self] _, resp, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard let http = resp as? HTTPURLResponse else {
                    self.isSendingCloudCmd = false
                    self.isCloudSynced = false
                    return
                }

                if (200..<300).contains(http.statusCode) {
                    if let first = self.pendingCloudCmdQueue.first, first.cmdId == head.cmdId {
                        self.pendingCloudCmdQueue.removeFirst()
                        self.persistCloudCmdQueue()
                    }
                    self.isSendingCloudCmd = false
                    self.isCloudSynced = true
                    self.cloudStatusMessage = ""

                    if !self.pendingCloudCmdQueue.isEmpty {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
                            self?.processPendingCloudCmdQueue()
                        }
                    }
                } else if http.statusCode == 403 || http.statusCode == 404 {
                    self.isSendingCloudCmd = false
                    self.isCloudSynced = false
                    self.clearCloudSessionToken()
                    self.pairingTerminalError = true
                    self.cloudStatusMessage = (http.statusCode == 404)
                        ? self.tr("SESIÓN CERRADA", "SESSION CLOSED")
                        : self.tr("SESIÓN EXPIRADA", "SESSION EXPIRED")
                } else {
                    self.isSendingCloudCmd = false
                    self.isCloudSynced = false
                }
            }
        }.resume()
    }

    // MARK: - Adaptive Cloud Polling (`watch_sessions/<cloudSessionToken>`)

    private func currentAdaptivePollIntervalMs(nowMs: Int64) -> Int64 {
        if analysisMode {
            return 3_000
        }
        let idleMs = max(0, nowMs - lastActivityMs)
        if idleMs < 90_000 {
            return 8_000
        } else if idleMs < 300_000 {
            return 20_000
        }
        return 45_000
    }

    private func scheduleNextCloudPoll() {
        let scheduleWork = { [weak self] in
            guard let self = self else { return }
            self.cloudPollTimer?.invalidate()
            let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
            let intervalMs = self.currentAdaptivePollIntervalMs(nowMs: nowMs)
            let elapsedMs = self.lastCloudPollMs > 0 ? max(0, nowMs - self.lastCloudPollMs) : 0
            let waitMs = max(1_000, intervalMs - elapsedMs)
            let timer = Timer.scheduledTimer(withTimeInterval: Double(waitMs) / 1000.0, repeats: false) { [weak self] _ in
                guard let self = self else { return }
                if !self.isEditingCode && !self.pairingTerminalError {
                    if !self.cloudSessionToken.isEmpty {
                        self.pollFirestoreCloud()
                        self.processPendingCloudCmdQueue()
                    } else if self.hasPairingCode {
                        self.claimPairingTokenIfNeeded()
                    }
                }
                self.scheduleNextCloudPoll()
            }
            timer.tolerance = min(1.0, (Double(waitMs) / 1000.0) * 0.1)
            self.cloudPollTimer = timer
        }
        if Thread.isMainThread {
            scheduleWork()
        } else {
            DispatchQueue.main.async(execute: scheduleWork)
        }
    }

    func markUserActivity(isWriteAction: Bool = false) {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        lastActivityMs = nowMs
        if isWriteAction {
            lastLocalActionMs = nowMs
        } else if !isEditingCode && !pairingTerminalError && (nowMs - lastLocalActionMs) >= 3_500 {
            if lastCloudPollMs == 0 || (nowMs - lastCloudPollMs) >= 8_000 {
                if !cloudSessionToken.isEmpty {
                    pollFirestoreCloud()
                } else if hasPairingCode {
                    claimPairingTokenIfNeeded()
                }
            }
        }
        scheduleNextCloudPoll()
    }

    private func startCloudPollingTimer() {
        scheduleNextCloudPoll()
    }

    func pollFirestoreCloud() {
        if cloudSessionToken.isEmpty {
            if hasPairingCode && !pairingTerminalError {
                claimPairingTokenIfNeeded()
            }
            return
        }
        guard Self.isValidSessionToken(cloudSessionToken),
              let url = URL(string: "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/\(cloudSessionToken)") else {
            return
        }
        lastCloudPollMs = Int64(Date().timeIntervalSince1970 * 1000)

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.cachePolicy = .reloadIgnoringLocalCacheData

        cloudUrlSession.dataTask(with: req) { [weak self] data, resp, _ in
            guard let self = self, let http = resp as? HTTPURLResponse else { return }
            if http.statusCode == 200,
               let data = data,
               let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let fields = root["fields"] as? [String: Any] {
                func fsInt(_ key: String, _ fallback: Int) -> Int {
                    guard let node = fields[key] as? [String: Any] else { return fallback }
                    if let s = node["integerValue"] as? String, let n = Int(s) { return n }
                    if let d = node["doubleValue"] as? Double { return Int(round(d)) }
                    return fallback
                }
                func fsDouble(_ key: String, _ fallback: Double) -> Double {
                    guard let node = fields[key] as? [String: Any] else { return fallback }
                    if let d = node["doubleValue"] as? Double { return d }
                    if let s = node["integerValue"] as? String, let n = Double(s) { return n }
                    return fallback
                }
                func fsBool(_ key: String, _ fallback: Bool) -> Bool {
                    guard let node = fields[key] as? [String: Any],
                          let b = node["booleanValue"] as? Bool else { return fallback }
                    return b
                }
                let activeNode = fields["sessionActive"] as? [String: Any]
                let sessionActive = (activeNode?["booleanValue"] as? Bool) ?? true
                let sidNode = fields["sessionId"] as? [String: Any]
                let incomingSid = (sidNode?["stringValue"] as? String) ?? ""

                var hasEndArrowsField = false
                var parsedEndArrows: [String] = []
                if let arrNode = fields["currentEndArrows"] as? [String: Any],
                   let av = arrNode["arrayValue"] as? [String: Any] {
                    hasEndArrowsField = true
                    if let vals = av["values"] as? [[String: Any]] {
                        for item in vals {
                            if let sv = item["stringValue"] as? String {
                                parsedEndArrows.append(sv)
                            }
                        }
                    }
                }
                let endArrowsJoined = parsedEndArrows.joined(separator: ",")

                DispatchQueue.main.async {
                    self.isCloudSynced = true
                    self.cloudStatusMessage = ""
                    let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
                    let fsArrows = fsInt("arrowsCount", self.arrowCount)
                    let fsScore = fsInt("totalScore", self.totalScore)
                    let fsEnd = max(1, fsInt("currentEnd", self.currentEnd))
                    let fsDistM = fsInt("distanceM", self.distanceM)
                    let fsPerEnd = max(1, fsInt("arrowsPerEnd", self.arrowsPerEnd))
                    let fsEnds = max(1, fsInt("totalEnds", self.endsCount))
                    let fsSens = max(0, min(2, fsInt("sensitivityLevel", self.sensitivityLevel)))
                    let fsPoundage = fsDouble("bowPoundageLbs", self.bowPoundageLbs)
                    let ptStr = ((fields["practiceType"] as? [String: Any])?["stringValue"] as? String) ?? ""
                    let btStr = ((fields["bowType"] as? [String: Any])?["stringValue"] as? String) ?? ""
                    let fsAnalysis = fsBool("analysisMode", ptStr == "Análisis")
                    let fsAuto = fsBool("autoDetectEnabled", self.autoDetectEnabled)
                    let calJson = ((fields["analysisCalibrationJson"] as? [String: Any])?["stringValue"] as? String) ?? ""

                    let remoteSig = "\(sessionActive ? 1 : 0)|\(incomingSid)|\(fsArrows)|\(fsScore)|\(fsEnd)|\(endArrowsJoined)|\(fsDistM)|\(fsPerEnd)|\(fsEnds)|\(fsSens)"
                    if self.lastRemoteStateSig.isEmpty {
                        self.lastRemoteStateSig = remoteSig
                    } else if self.lastRemoteStateSig != remoteSig {
                        self.lastRemoteStateSig = remoteSig
                        self.lastActivityMs = nowMs
                        self.scheduleNextCloudPoll()
                    }

                    let hasUnflushedLocalWrites = !self.pendingCloudCmdQueue.isEmpty || self.isSendingCloudCmd || ((nowMs - self.lastLocalActionMs) < 3_500)

                    if !sessionActive {
                        if !hasUnflushedLocalWrites && (self.arrowCount > 0 || self.totalScore > 0 || self.stepsCount > 0 || !self.currentSessionId.isEmpty) {
                            self.stopHeartRateStreaming()
                            self.resetSessionCounters(newSessionId: "")
                        }
                        return
                    }

                    if !incomingSid.isEmpty && !self.currentSessionId.isEmpty && incomingSid != self.currentSessionId {
                        if !hasUnflushedLocalWrites {
                            self.resetSessionCounters(newSessionId: incomingSid)
                        }
                    } else if !incomingSid.isEmpty && self.currentSessionId.isEmpty {
                        self.currentSessionId = incomingSid
                        UserDefaults.standard.set(incomingSid, forKey: "currentSessionId")
                    }

                    if sessionActive && (!incomingSid.isEmpty || fsArrows > 0 || fsAnalysis) && self.workoutSession == nil {
                        self.startHeartRateStreamingIfSupported()
                    }

                    if !hasUnflushedLocalWrites {
                        self.arrowCount = fsArrows
                        self.totalScore = fsScore
                        self.currentEnd = fsEnd
                        if hasEndArrowsField {
                            self.currentEndArrows = parsedEndArrows
                        }
                        self.sensitivityLevel = fsSens
                        UserDefaults.standard.set(fsSens, forKey: "sensitivityLevel")
                    }

                    self.distanceM = max(5, fsDistM)
                    self.arrowsPerEnd = fsPerEnd
                    self.endsCount = fsEnds
                    if fsPoundage >= 10.0 && fsPoundage <= 200.0 {
                        self.bowPoundageLbs = fsPoundage
                    }
                    if !ptStr.isEmpty {
                        self.practiceTypeStr = ptStr
                        UserDefaults.standard.set(ptStr, forKey: self.practiceTypePrefsKey)
                    }
                    if !btStr.isEmpty {
                        self.bowTypeStr = btStr
                    }

                    self.autoDetectEnabled = fsAuto
                    if self.analysisMode != fsAnalysis {
                        self.analysisMode = fsAnalysis
                        if !fsAnalysis {
                            self.manualAnalysisRecording = false
                            self.manualTimer?.invalidate()
                        }
                        self.syncShotDetectionMotionSensors()
                    }

                    if !calJson.isEmpty,
                       let calData = calJson.data(using: .utf8),
                       let calObj = try? JSONSerialization.jsonObject(with: calData) as? [String: Any] {
                        if let bt = calObj["bowType"] as? String, !bt.isEmpty { self.bowTypeStr = bt }
                        if let bw = calObj["bowWrist"] as? String, (bw == "LEFT" || bw == "RIGHT") { self.bowWristStr = bw }
                        if let wKg = (calObj["athleteWeightKg"] as? Double) ?? (calObj["weightKg"] as? Double),
                           wKg >= 25.0 && wKg <= 250.0 {
                            self.athleteWeightKg = wKg
                            UserDefaults.standard.set(wKg, forKey: self.weightKgPrefsKey)
                        }
                        let reqStart = (calObj["manualStartAt"] as? Int64) ?? Int64((calObj["manualStartAt"] as? Double) ?? 0)
                        let reqStop = (calObj["manualStopAt"] as? Int64) ?? Int64((calObj["manualStopAt"] as? Double) ?? 0)
                        let reqCal = (calObj["calibrateZeroAt"] as? Int64) ?? Int64((calObj["calibrateZeroAt"] as? Double) ?? 0)
                        if reqCal > 0 && reqCal != self.lastHandledCalibrateAt && (nowMs - reqCal) <= 25_000 {
                            self.lastHandledCalibrateAt = reqCal
                            self.calibrateZeroReference(notifyPhone: true)
                        }
                        if reqStart > 0 && reqStart != self.lastHandledStartAt && (nowMs - reqStart) <= 25_000 && reqStop < reqStart {
                            self.lastHandledStartAt = reqStart
                            let startLag = max(0, min(12_000, nowMs - reqStart))
                            self.startManualAnalysis(notifyPhone: false, lagMs: startLag)
                        }
                        if reqStop > 0 && reqStop != self.lastHandledStopAt && (nowMs - reqStop) <= 15_000 {
                            self.lastHandledStopAt = reqStop
                            if self.manualAnalysisRecording {
                                let stopLag = max(0, min(9_000, nowMs - reqStop))
                                self.stopManualAnalysis(notifyPhone: false, lagMs: stopLag)
                            }
                        }
                    }

                    let cloudWalk = Double(fsInt("distanceWalkedM", 0))
                    if cloudWalk > self.distanceWalkedM {
                        self.distanceWalkedM = cloudWalk
                    }
                    let cloudKcal = fsInt("caloriesBurnedKcal", -1)
                    if cloudKcal > self.syncedActiveKcal {
                        self.syncedActiveKcal = cloudKcal
                    }
                }
            } else if http.statusCode == 403 || http.statusCode == 404 {
                DispatchQueue.main.async {
                    self.isCloudSynced = false
                    self.clearCloudSessionToken()
                    self.pairingTerminalError = true
                    self.cloudStatusMessage = (http.statusCode == 404)
                        ? self.tr("SESIÓN CERRADA", "SESSION CLOSED")
                        : self.tr("SESIÓN EXPIRADA", "SESSION EXPIRED")
                }
            }
        }.resume()
    }

    // MARK: - Analysis Mode & Shot Recording

    func startManualAnalysis(notifyPhone: Bool = true, lagMs: Int64 = 0) {
        guard analysisMode, !manualAnalysisRecording else { return }
        startHeartRateStreamingIfSupported()
        syncShotDetectionMotionSensors()
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let safeLag = (lagMs > 0 && lagMs <= 12_000) ? lagMs : 0
        manualAnalysisRecording = true
        manualAnalysisStartMs = nowMs - safeLag
        manualAnalysisElapsedSec = Double(safeLag) / 1000.0
        screenIndex = 0
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.start)
        manualTimer?.invalidate()
        manualTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
            guard let self = self, self.manualAnalysisRecording else { return }
            let curMs = Int64(Date().timeIntervalSince1970 * 1000)
            let sec = Double(max(0, curMs - self.manualAnalysisStartMs)) / 1000.0
            self.manualAnalysisElapsedSec = sec
            if sec >= 30.0 {
                self.stopManualAnalysis(notifyPhone: true)
            }
        }
        if notifyPhone {
            sendCommandToPhone([
                "type": "ANALYSIS_MANUAL_START",
                "ts": nowMs,
                "source": "watch_manual"
            ])
        }
    }

    func stopManualAnalysis(notifyPhone: Bool = true, lagMs: Int64 = 0) {
        guard manualAnalysisRecording else { return }
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let safeLag = (lagMs > 0 && lagMs <= 9_000) ? lagMs : 0
        var endMs = nowMs - safeLag
        let startMs = manualAnalysisStartMs
        if endMs <= startMs + 350 {
            endMs = nowMs
        }
        manualAnalysisRecording = false
        manualAnalysisStartMs = 0
        manualTimer?.invalidate()
        manualTimer = nil
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.stop)
        finalizeAnalysisWindow(
            startMs: startMs,
            endMs: endMs,
            notifyPhoneStopFallback: notifyPhone,
            isAutoShot: false
        )
    }

    private func finalizeAnalysisWindow(
        startMs: Int64,
        endMs: Int64,
        notifyPhoneStopFallback: Bool,
        isAutoShot: Bool
    ) {
        imuLock.lock()
        let windowSamples = motionBuf.filter { $0.t >= startMs && $0.t <= endMs - 20 }
        imuLock.unlock()

        guard windowSamples.count >= 6 else {
            if notifyPhoneStopFallback {
                sendCommandToPhone(["type": "ANALYSIS_MANUAL_STOP", "ts": endMs, "source": "watch_manual"])
            }
            return
        }

        // Step 1: Locate sustained aiming plateau & trim post-release arm drop / FINAL tap delay (units in g: 1.0 = 9.81 m/s^2)
        let rawCount = windowSamples.count
        var bestPlatIdx = max(1, rawCount - 2)
        var bestPlatScore = -1.0
        var curRun = 0
        var platAx = windowSamples[bestPlatIdx].ax
        var platAy = windowSamples[bestPlatIdx].ay
        var platAz = windowSamples[bestPlatIdx].az

        for i in 3..<rawCount {
            let wFrom = max(0, i - 10)
            var sumLin = 0.0, mAx = 0.0, mAy = 0.0, mAz = 0.0
            var minY = 999.0, maxY = -999.0, minZ = 999.0, maxZ = -999.0
            var wN = 0.0
            for j in wFrom...i {
                let s = windowSamples[j]
                let mag = sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az)
                sumLin += abs(mag - 1.0)
                mAx += s.ax; mAy += s.ay; mAz += s.az
                if s.ay < minY { minY = s.ay }
                if s.ay > maxY { maxY = s.ay }
                if s.az < minZ { minZ = s.az }
                if s.az > maxZ { maxZ = s.az }
                wN += 1.0
            }
            mAx /= wN; mAy /= wN; mAz /= wN
            let gNorm = max(0.4, sqrt(mAx * mAx + mAy * mAy + mAz * mAz))
            let perpG = sqrt(mAy * mAy + mAz * mAz)
            let postureOk = (abs(mAx) / gNorm <= 0.80) && (perpG >= 0.56)
            let spanOk = (maxY - minY <= 0.25) && (maxZ - minZ <= 0.25)
            if postureOk && spanOk && (sumLin / wN <= 0.14) {
                curRun += 1
                if curRun >= 12 && (windowSamples[i].t - windowSamples[0].t) >= 600 {
                    let pScore = Double(curRun) + (Double(i) / Double(rawCount)) * 12.0
                    if pScore >= bestPlatScore {
                        bestPlatScore = pScore
                        bestPlatIdx = i
                        platAx = mAx; platAy = mAy; platAz = mAz
                    }
                }
            } else {
                curRun = 0
            }
        }

        var effCount = max(4, rawCount - 1)
        if bestPlatScore > 0.0 {
            effCount = min(rawCount, bestPlatIdx + 1)
            let relStart = max(1, bestPlatIdx - 6)
            for r in relStart..<rawCount {
                let cur = windowSamples[r]
                let prev = windowSamples[r - 1]
                let magCur = sqrt(cur.ax * cur.ax + cur.ay * cur.ay + cur.az * cur.az)
                let magPrev = sqrt(prev.ax * prev.ax + prev.ay * prev.ay + prev.az * prev.az)
                let jerkG = abs(magCur - magPrev)
                let linDevG = abs(magCur - 1.0)
                let dropDistG = sqrt(pow(cur.ax - platAx, 2) + pow(cur.ay - platAy, 2) + pow(cur.az - platAz, 2))
                if jerkG >= 0.21 || linDevG >= 0.19 || (r > bestPlatIdx && dropDistG >= 0.25) {
                    effCount = max(4, r)
                    break
                }
            }
        }

        let trimmedSamples = Array(windowSamples.prefix(effCount))
        let refSlice = Array(trimmedSamples.suffix(min(15, trimmedSamples.count)))
        let refAx = refSlice.reduce(0.0) { $0 + $1.ax } / Double(refSlice.count)
        let refAy = refSlice.reduce(0.0) { $0 + $1.ay } / Double(refSlice.count)
        let refAz = refSlice.reduce(0.0) { $0 + $1.az } / Double(refSlice.count)
        let refNorm = max(0.4, sqrt(refAx * refAx + refAy * refAy + refAz * refAz))
        let wristSign = (bowWristStr == "RIGHT") ? -1.0 : 1.0
        let forePitchWeight = (abs(refAz) < 0.75) ? 0.85 : 0.35
        let faceRadiusCm = (distanceM <= 20) ? 20.0 : ((distanceM <= 26) ? 30.0 : ((distanceM <= 36) ? 40.0 : 61.0))
        let distCm = max(1000.0, Double(distanceM) * 100.0)

        var sAx = trimmedSamples[0].ax
        var sAy = trimmedSamples[0].ay
        var sAz = trimmedSamples[0].az
        var nxArr: [Double] = []
        var nyArr: [Double] = []
        var gdArr: [Double] = []
        for s in trimmedSamples {
            sAx = 0.80 * sAx + 0.20 * s.ax
            sAy = 0.80 * sAy + 0.20 * s.ay
            sAz = 0.80 * sAz + 0.20 * s.az
            let yaw = ((sAy - refAy) / refNorm) * wristSign * 0.28
            let pitch = (((sAz - refAz) + (sAx - refAx) * wristSign * forePitchWeight) / refNorm) * 0.28
            let dxCm = tan(yaw) * distCm
            let dyCm = tan(pitch) * distCm
            nxArr.append(max(-1.08, min(1.08, dxCm / faceRadiusCm)))
            nyArr.append(max(-1.08, min(1.08, dyCm / faceRadiusCm)))
            gdArr.append(sqrt(pow(sAx - refAx, 2) + pow(sAy - refAy, 2) + pow(sAz - refAz, 2)))
        }

        let n = trimmedSamples.count
        let baseGd = gdArr.suffix(min(15, n)).reduce(0.0, +) / Double(min(15, n))
        let gdLimitG = max(0.036, min(0.105, baseGd * 2.15 + 0.020))

        var settleIdx = 1
        for sIdx in stride(from: max(1, n - 2), through: 1, by: -1) {
            let radNorm = hypot(nxArr[sIdx], nyArr[sIdx])
            let prevIdx = max(0, sIdx - 11)
            let driftG = abs(gdArr[sIdx] - gdArr[prevIdx])
            var pathLenNorm = 0.0
            if sIdx > prevIdx {
                for pStep in (prevIdx + 1)...sIdx {
                    pathLenNorm += hypot(nxArr[pStep] - nxArr[pStep - 1], nyArr[pStep] - nyArr[pStep - 1])
                }
            }
            let netDriftNorm = hypot(nxArr[sIdx] - nxArr[prevIdx], nyArr[sIdx] - nyArr[prevIdx])
            let oldestRadNorm = hypot(nxArr[prevIdx], nyArr[prevIdx])
            let isMonotonicApproach = oldestRadNorm > 0.18 && netDriftNorm > 0.21 && pathLenNorm > 0.01 && (netDriftNorm / pathLenNorm) >= 0.82
            if gdArr[sIdx] > gdLimitG || radNorm > 0.24 || driftG > 0.029 || isMonotonicApproach {
                let priorIdx = max(0, sIdx - 20)
                if sIdx < 20 || gdArr[priorIdx] > gdLimitG || hypot(nxArr[priorIdx], nyArr[priorIdx]) > 0.24 {
                    settleIdx = min(n - 2, sIdx + 1)
                    break
                }
            }
            settleIdx = sIdx
        }
        settleIdx = max(1, min(n - 2, settleIdx))

        var prepStartIdx = 0
        var sawLift = false
        if settleIdx >= 2 {
            for pIdx in stride(from: settleIdx - 1, through: 1, by: -1) {
                let stepShiftG = abs(gdArr[pIdx] - gdArr[pIdx - 1])
                let armLoweredFromSetUp = gdArr[pIdx] >= 0.225
                if stepShiftG >= 0.008 {
                    sawLift = true
                } else if sawLift && armLoweredFromSetUp && (trimmedSamples[settleIdx].t - trimmedSamples[pIdx].t) >= 450 && stepShiftG < 0.004 {
                    prepStartIdx = pIdx
                    break
                }
            }
        }

        let maxPrepCap = isAutoShot ? 6.5 : 10.0
        let maxAimCap = isAutoShot ? 14.0 : 24.0
        let prepSec = max(0.4, min(maxPrepCap, Double(trimmedSamples[settleIdx].t - trimmedSamples[prepStartIdx].t) / 1000.0))
        let aimSec = max(0.5, min(maxAimCap, Double(trimmedSamples[n - 1].t - trimmedSamples[settleIdx].t) / 1000.0))

        // Zero-centered RMS Sway across Aiming + Critical 1.5s Hold MOA (matching Web, Wear OS & Connect IQ 100%)
        let aimCount = max(1, n - settleIdx)
        var meanAimNx = 0.0
        var meanAimNy = 0.0
        for i in settleIdx..<n {
            meanAimNx += nxArr[i]
            meanAimNy += nyArr[i]
        }
        meanAimNx /= Double(aimCount)
        meanAimNy /= Double(aimCount)

        var sumSq = 0.0
        for i in settleIdx..<n {
            let cxCm = (nxArr[i] - meanAimNx) * faceRadiusCm
            let cyCm = (nyArr[i] - meanAimNy) * faceRadiusCm
            sumSq += cxCm * cxCm + cyCm * cyCm
        }
        let swayCm = max(0.3, min(faceRadiusCm, sqrt(sumSq / Double(aimCount))))
        let stabPct = max(38, min(99, Int(round(100.0 - (swayCm / faceRadiusCm) * 82.0))))

        var critFrom = settleIdx
        for i in stride(from: n - 1, through: settleIdx, by: -1) {
            if (trimmedSamples[n - 1].t - trimmedSamples[i].t) <= 1500 {
                critFrom = i
            }
        }
        let critCount = max(1, n - critFrom)
        var critMx = 0.0, critMy = 0.0
        for i in critFrom..<n {
            critMx += nxArr[i]
            critMy += nyArr[i]
        }
        critMx /= Double(critCount)
        critMy /= Double(critCount)
        var critSqCm = 0.0
        for i in critFrom..<n {
            let rxC = (nxArr[i] - critMx) * faceRadiusCm
            let ryC = (nyArr[i] - critMy) * faceRadiusCm
            critSqCm += rxC * rxC + ryC * ryC
        }
        let critRmsCm = sqrt(critSqCm / Double(critCount))
        let holdMoa = max(0.4, min(60.0, atan2(critRmsCm, distCm) * 3437.7468))

        var ftPct = 92
        if effCount < rawCount {
            let followEnd = min(rawCount, effCount + 8)
            let followSlice = windowSamples[effCount..<followEnd]
            if !followSlice.isEmpty {
                let fAx = followSlice.reduce(0.0) { $0 + $1.ax } / Double(followSlice.count)
                let fAy = followSlice.reduce(0.0) { $0 + $1.ay } / Double(followSlice.count)
                let fAz = followSlice.reduce(0.0) { $0 + $1.az } / Double(followSlice.count)
                let fDriftMps2 = sqrt(pow(fAx - refAx, 2) + pow(fAy - refAy, 2) + pow(fAz - refAz, 2)) * 9.81
                ftPct = max(42, min(99, Int(round(100.0 - max(0.0, fDriftMps2 - 0.85) * 9.5))))
            }
        }

        let preIdx = max(0, n - 8)
        let relJumpCm = max(0.2, hypot(nxArr[n - 1] - nxArr[preIdx], nyArr[n - 1] - nyArr[preIdx]) * faceRadiusCm)
        let rdCode = (relJumpCm > faceRadiusCm * 0.16) ? "A" : ((ftPct < 72) ? "D" : "C")

        let pCount = min(8, max(2, settleIdx - prepStartIdx + 1))
        var pPts: [[Double]] = []
        for j in 0..<pCount {
            let idx = min(n - 1, prepStartIdx + (j * max(1, settleIdx - prepStartIdx)) / max(1, pCount - 1))
            pPts.append([
                (nxArr[idx] * 1000.0).rounded() / 1000.0,
                (nyArr[idx] * 1000.0).rounded() / 1000.0
            ])
        }
        let aCount = min(16, max(2, n - settleIdx))
        var aPts: [[Double]] = []
        for j in 0..<aCount {
            let idx = min(n - 1, settleIdx + (j * (n - 1 - settleIdx)) / max(1, aCount - 1))
            aPts.append([
                (nxArr[idx] * 1000.0).rounded() / 1000.0,
                (nyArr[idx] * 1000.0).rounded() / 1000.0
            ])
        }

        arrowCount += 1
        lastAnalysisStabPct = stabPct
        let shotTsMs = trimmedSamples[n - 1].t
        var compact: [String: Any] = [
            "id": "SHOT-\(shotTsMs)-\(arrowCount)",
            "n": arrowCount,
            "ts": shotTsMs,
            "d": distanceM,
            "bowType": bowTypeStr,
            "prepSec": (prepSec * 10.0).rounded() / 10.0,
            "aimSec": (aimSec * 10.0).rounded() / 10.0,
            "stab": stabPct,
            "swayCm": (swayCm * 10.0).rounded() / 10.0,
            "moa": (holdMoa * 10.0).rounded() / 10.0,
            "relCm": (relJumpCm * 10.0).rounded() / 10.0,
            "ft": ftPct,
            "rd": rdCode,
            "p": pPts,
            "a": aPts,
            "r": aPts.last ?? [0.0, 0.0]
        ]
        if heartRateBpm >= 30 && heartRateBpm <= 245 {
            compact["bpm"] = heartRateBpm
        }

        var finalJsonStr: String? = nil
        if let jsonData = try? JSONSerialization.data(withJSONObject: compact),
           let str = String(data: jsonData, encoding: .utf8) {
            if str.count <= 3450 {
                finalJsonStr = str
            } else {
                compact["p"] = Array(pPts.prefix(4))
                compact["a"] = Array(aPts.prefix(8))
                if let slimData = try? JSONSerialization.data(withJSONObject: compact),
                   let slimStr = String(data: slimData, encoding: .utf8) {
                    finalJsonStr = String(slimStr.prefix(3500))
                }
            }
        }

        if let jsonStr = finalJsonStr {
            var cmd: [String: Any] = [
                "type": "ANALYSIS_SHOT",
                "analysisShotJson": jsonStr,
                "value": jsonStr
            ]
            if heartRateBpm >= 30 && heartRateBpm <= 245 {
                cmd["heartRateBpm"] = heartRateBpm
            }
            sendCommandToPhone(cmd)
        }
    }

    func toggleManualAnalysisFromHardware() {
        if manualAnalysisRecording {
            stopManualAnalysis(notifyPhone: true)
        } else {
            startManualAnalysis(notifyPhone: true)
        }
    }

    func handleHardwarePrimaryAction() {
        if analysisMode {
            toggleManualAnalysisFromHardware()
        } else {
            incrementArrow(delta: 1, source: "watch_hardware")
        }
    }

    func incrementArrow(delta: Int, source: String = "watch_manual") {
        if delta > 0 && workoutSession == nil {
            startHeartRateStreamingIfSupported()
        }
        markUserActivity(isWriteAction: true)
        arrowCount = max(0, arrowCount + delta)
        WKInterfaceDevice.current().play(delta > 0 ? .directionUp : .directionDown)
        let evt = delta > 0 ? "INCREMENT_ARROW" : "DECREMENT_ARROW"
        sendCommandToPhone([
            "type": evt,
            "delta": delta,
            "source": source,
            "totalScore": totalScore
        ])
    }

    func recordScore(_ label: String) {
        if workoutSession == nil {
            startHeartRateStreamingIfSupported()
        }
        markUserActivity(isWriteAction: true)
        scorepadHintText = ""
        if currentEndArrows.count >= arrowsPerEnd {
            if currentEnd < endsCount {
                currentEnd += 1
                currentEndArrows.removeAll()
            } else {
                scorepadHintText = tr("RONDA COMPLETA", "ROUND COMPLETE")
                WKInterfaceDevice.current().play(.notification)
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
        guard !currentEndArrows.isEmpty else {
            markUserActivity(isWriteAction: false)
            return
        }
        markUserActivity(isWriteAction: true)
        scorepadHintText = ""
        let removed = currentEndArrows.removeLast()
        let pts = (removed == "X" || removed == "10") ? 10 : (removed == "M" ? 0 : (Int(removed) ?? 0))
        totalScore = max(0, totalScore - pts)
        arrowCount = max(0, arrowCount - 1)
        WKInterfaceDevice.current().play(.click)
        sendCommandToPhone(["type": "UNDO_ARROW", "totalScore": totalScore])
    }

    func advanceToNextEnd() {
        // Guard incomplete ends so watch never wipes currentEndArrows while ScoringView rejects NEXT_END (AUD-WATCH-07)
        guard currentEndArrows.count >= arrowsPerEnd else {
            markUserActivity(isWriteAction: false)
            scorepadHintText = tr("COMPLETA \(arrowsPerEnd) FLECHAS", "COMPLETE \(arrowsPerEnd) ARROWS")
            WKInterfaceDevice.current().play(.failure)
            return
        }
        guard currentEnd < endsCount else {
            scorepadHintText = tr("ÚLTIMA TANDA", "FINAL END")
            WKInterfaceDevice.current().play(.notification)
            return
        }
        markUserActivity(isWriteAction: true)
        scorepadHintText = ""
        currentEndArrows.removeAll()
        currentEnd += 1
        WKInterfaceDevice.current().play(.success)
        sendCommandToPhone(["type": "NEXT_END"])
    }

    func syncTelemetryManual() {
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.click)
        maybeSyncTelemetryToPhone(force: true)
        if !cloudSessionToken.isEmpty {
            pollFirestoreCloud()
            processPendingCloudCmdQueue()
        } else if hasPairingCode {
            pairingTerminalError = false
            claimPairingTokenIfNeeded()
        }
    }

    func requestFinishSession() {
        markUserActivity(isWriteAction: false)
        let isLinkedAnywhere = isPhoneConnected || !cloudSessionToken.isEmpty
        if !isLinkedAnywhere && (arrowCount > 0 || totalScore > 0 || stepsCount > 0) {
            WKInterfaceDevice.current().play(.notification)
            showUnlinkedSaveWarning = true
            return
        }
        WKInterfaceDevice.current().play(.click)
        showFinishConfirmation = true
    }

    func confirmFinishSession() {
        showFinishConfirmation = false
        showUnlinkedSaveWarning = false
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.success)

        // 1. Enqueue final biometrics snapshot + FINISH_SESSION_FROM_WATCH BEFORE resetting UI counters!
        maybeSyncTelemetryToPhone(force: true)
        sendCommandToPhone(["type": "FINISH_SESSION_FROM_WATCH"])

        // 2. End HealthKit workout & optical HR LED cleanly
        stopHeartRateStreaming()

        // 3. Reset local UI counters after payload snapshot is safely persisted in FIFO queue
        resetSessionCounters(newSessionId: "")
        screenIndex = 0
    }

    func discardLocalUnlinkedSession() {
        showUnlinkedSaveWarning = false
        stopHeartRateStreaming()
        resetSessionCounters(newSessionId: "")
        screenIndex = 0
    }

    // MARK: - Outbound Phone Transport (`WCSession` + Serial Cloud FIFO)

    func sendCommandToPhone(_ payload: [String: Any]) {
        if let evtType = payload["type"] as? String {
            let extra = (payload["analysisShotJson"] as? String)
                ?? (payload["value"] as? String)
                ?? (payload["source"] as? String)
            let deltaVal = payload["delta"] as? Int
            let zeroVec = payload["zeroGravityVec"] as? [Double]
            enqueueCloudWatchCommand(
                eventType: evtType,
                extraValue: extra,
                explicitDelta: deltaVal,
                explicitZeroVec: zeroVec
            )
        }

        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else {
            session.activate()
            return
        }

        let seq = nextCmdSequence()
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        var enriched = payload
        let idStr = "wc-\(nowMs)-\(seq)"
        enriched["_cmdId"] = idStr
        enriched["cmdId"] = idStr
        enriched["_cmdSeq"] = seq
        enriched["_ts"] = nowMs

        if session.isReachable {
            session.sendMessage(enriched, replyHandler: { [weak self] reply in
                DispatchQueue.main.async {
                    self?.isPhoneConnected = true
                    if !reply.isEmpty {
                        self?.handleIncomingPhoneContext(reply)
                    }
                }
            }, errorHandler: { [weak self] _ in
                DispatchQueue.main.async {
                    self?.isPhoneConnected = session.isReachable
                }
                if session.activationState == .activated {
                    session.transferUserInfo(enriched)
                }
            })
        } else {
            session.transferUserInfo(enriched)
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isPhoneConnected = (activationState == .activated && session.isReachable)
        }
        if activationState == .activated {
            let ctx = session.receivedApplicationContext
            if !ctx.isEmpty {
                handleIncomingPhoneContext(ctx)
            }
            if session.isReachable {
                let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
                session.sendMessage(["type": "REQUEST_STATE", "_ts": nowMs], replyHandler: { [weak self] reply in
                    self?.handleIncomingPhoneContext(reply)
                }, errorHandler: nil)
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isPhoneConnected = (session.activationState == .activated && session.isReachable)
        }
        if session.activationState == .activated && session.isReachable {
            let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
            session.sendMessage(["type": "REQUEST_STATE", "_ts": nowMs], replyHandler: { [weak self] reply in
                self?.handleIncomingPhoneContext(reply)
            }, errorHandler: nil)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        handleIncomingPhoneContext(applicationContext)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleIncomingPhoneContext(message)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        handleIncomingPhoneContext(message)
        var reply: [String: Any] = [
            "type": "PONG",
            "stepsCount": stepsCount,
            "distanceWalkedM": walkedMetersInt,
            "_ts": Int64(Date().timeIntervalSince1970 * 1000)
        ]
        if heartRateBpm >= 30 && heartRateBpm <= 245 {
            reply["heartRateBpm"] = heartRateBpm
            reply["bpm"] = heartRateBpm
        }
        if avgHeartRateBpm >= 30 && avgHeartRateBpm <= 245 {
            reply["avgHeartRateBpm"] = avgHeartRateBpm
        }
        if maxHeartRateBpm >= 30 && maxHeartRateBpm <= 245 {
            reply["maxHeartRateBpm"] = maxHeartRateBpm
        }
        replyHandler(reply)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handleIncomingPhoneContext(userInfo)
    }

    private func adoptPhoneCloudTokensIfValid(from dict: [String: Any], inner: [String: Any]?) {
        let tokenCandidate = (dict["sessionToken"] as? String) ?? (inner?["sessionToken"] as? String) ?? ""
        let codeCandidate = (dict["pairingCode"] as? String) ?? (inner?["pairingCode"] as? String) ?? ""

        var tokenUpdated = false
        if Self.isValidPairingCode(codeCandidate) && codeCandidate != pairingCode {
            pairingCode = codeCandidate
            hasPairingCode = true
            parsePairingDigits(codeCandidate)
            UserDefaults.standard.set(codeCandidate, forKey: pairingCodePrefsKey)
        }
        if Self.isValidSessionToken(tokenCandidate) && tokenCandidate != cloudSessionToken {
            saveCloudSessionToken(tokenCandidate)
            isCloudSynced = true
            cloudStatusMessage = ""
            tokenUpdated = true
        }
        if tokenUpdated {
            processPendingCloudCmdQueue()
        }
    }

    private func handlePhoneCommandPayload(_ dict: [String: Any]) {
        var merged = dict
        if let cmdJson = dict["command_json"] as? String,
           let cmdData = cmdJson.data(using: .utf8),
           let parsedCmd = try? JSONSerialization.jsonObject(with: cmdData) as? [String: Any] {
            for (k, v) in parsedCmd where merged[k] == nil {
                merged[k] = v
            }
            if merged["cmdType"] == nil, let t = parsedCmd["type"] as? String {
                merged["cmdType"] = t
            }
        }

        guard let cmdType = merged["cmdType"] as? String else { return }

        switch cmdType {
        case "SET_SENSITIVITY":
            if let sens = merged["sensitivityLevel"] as? Int {
                sensitivityLevel = max(0, min(2, sens))
                UserDefaults.standard.set(sensitivityLevel, forKey: "sensitivityLevel")
            }
        case "TOGGLE_AUTO_DETECT":
            if let enabled = merged["enabled"] as? Bool {
                autoDetectEnabled = enabled
                UserDefaults.standard.set(enabled, forKey: "autoDetectEnabled_v2")
                syncShotDetectionMotionSensors()
            }
            if let sens = merged["sensitivityLevel"] as? Int {
                sensitivityLevel = max(0, min(2, sens))
                UserDefaults.standard.set(sensitivityLevel, forKey: "sensitivityLevel")
            }
        case "ANALYSIS_MANUAL_START":
            if !analysisMode {
                analysisMode = true
                syncShotDetectionMotionSensors()
            }
            startManualAnalysis(notifyPhone: false)
        case "ANALYSIS_MANUAL_STOP":
            if manualAnalysisRecording {
                stopManualAnalysis(notifyPhone: false)
            }
        case "CALIBRATE_ZERO", "ANALYSIS_CALIBRATE_ZERO":
            calibrateZeroReference(notifyPhone: true)
        case "ZERO_VECTOR", "ANALYSIS_ZERO_VECTOR":
            if let vec = merged["zeroGravityVec"] as? [Double], vec.count == 3 {
                calibratedZeroVec = vec
                WKInterfaceDevice.current().play(.click)
            } else if let nums = merged["zeroGravityVec"] as? [NSNumber], nums.count == 3 {
                calibratedZeroVec = nums.map { $0.doubleValue }
                WKInterfaceDevice.current().play(.click)
            }
        default:
            break
        }
    }

    private func handleIncomingPhoneContext(_ dict: [String: Any]) {
        if let msgType = dict["type"] as? String {
            if msgType == "PING" {
                DispatchQueue.main.async {
                    self.isPhoneConnected = true
                    self.adoptPhoneCloudTokensIfValid(from: dict, inner: nil)
                }
                return
            }
            if msgType == "HR_REQUEST" {
                DispatchQueue.main.async {
                    self.isPhoneConnected = true
                    self.startHeartRateStreamingIfSupported()
                    if self.heartRateBpm >= 30 {
                        self.sendHeartRateStatusToPhone(bpm: self.heartRateBpm, status: "ok")
                    }
                }
                return
            }
            if msgType == "PHONE_COMMAND" {
                DispatchQueue.main.async {
                    self.isPhoneConnected = true
                    self.lastActivityMs = Int64(Date().timeIntervalSince1970 * 1000)
                    self.handlePhoneCommandPayload(dict)
                    self.scheduleNextCloudPoll()
                }
                return
            }
        }

        guard let snapStr = dict["snapshot_json"] as? String,
              let data = snapStr.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            DispatchQueue.main.async {
                self.adoptPhoneCloudTokensIfValid(from: dict, inner: nil)
            }
            return
        }

        let obj = (json["payload"] as? [String: Any]) ?? json
        DispatchQueue.main.async {
            self.isPhoneConnected = WCSession.default.isReachable
            self.adoptPhoneCloudTokensIfValid(from: dict, inner: obj)

            let sessionActive = (obj["sessionActive"] as? Bool) ?? true
            let incomingSessionId = (obj["sessionId"] as? String) ?? ""
            let nextArrows = (obj["arrowsCount"] as? Int) ?? self.arrowCount
            let nextScore = (obj["totalScore"] as? Int) ?? self.totalScore
            let nextEndIdx = (obj["currentEndIndex"] as? Int) ?? (self.currentEnd - 1)
            let nextEndArrows = ((obj["currentEndArrows"] as? [String]) ?? self.currentEndArrows).joined(separator: ",")
            let nextDistM = (obj["distanceM"] as? Int) ?? self.distanceM
            let nextSens = (obj["sensitivityLevel"] as? Int) ?? self.sensitivityLevel
            let phoneSig = "\(sessionActive ? 1 : 0)|\(incomingSessionId)|\(nextArrows)|\(nextScore)|\(nextEndIdx)|\(nextEndArrows)|\(nextDistM)|\(nextSens)"

            if self.lastPhoneContextSig.isEmpty {
                self.lastPhoneContextSig = phoneSig
            } else if self.lastPhoneContextSig != phoneSig {
                self.lastPhoneContextSig = phoneSig
                self.lastActivityMs = Int64(Date().timeIntervalSince1970 * 1000)
                self.scheduleNextCloudPoll()
            }

            let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
            let recentlyActed = (nowMs - self.lastLocalActionMs) < 2_500

            if !sessionActive || (!incomingSessionId.isEmpty && !self.currentSessionId.isEmpty && incomingSessionId != self.currentSessionId) {
                if !sessionActive {
                    self.stopHeartRateStreaming()
                }
                self.resetSessionCounters(newSessionId: sessionActive ? incomingSessionId : "")
                if !sessionActive {
                    return
                }
            } else if !incomingSessionId.isEmpty && self.currentSessionId.isEmpty {
                self.currentSessionId = incomingSessionId
                UserDefaults.standard.set(incomingSessionId, forKey: "currentSessionId")
            }

            if sessionActive && (!incomingSessionId.isEmpty || nextArrows > 0) && self.workoutSession == nil {
                self.startHeartRateStreamingIfSupported()
            }

            if !recentlyActed {
                if let arrows = obj["arrowsCount"] as? Int { self.arrowCount = max(0, arrows) }
                if let score = obj["totalScore"] as? Int { self.totalScore = max(0, score) }
                if let curIdx = obj["currentEndIndex"] as? Int { self.currentEnd = max(1, curIdx + 1) }
                if let endArrows = obj["currentEndArrows"] as? [String] { self.currentEndArrows = endArrows }
            }

            if let distM = obj["distanceM"] as? Int { self.distanceM = max(5, distM) }
            if let lbs = obj["bowPoundageLbs"] as? Double { self.bowPoundageLbs = max(12.0, lbs) }
            else if let lbsInt = obj["bowPoundageLbs"] as? Int { self.bowPoundageLbs = max(12.0, Double(lbsInt)) }
            if let wKg = (obj["athleteWeightKg"] as? Double) ?? (obj["weightKg"] as? Double),
               wKg >= 25.0 && wKg <= 250.0 {
                self.athleteWeightKg = wKg
                UserDefaults.standard.set(wKg, forKey: self.weightKgPrefsKey)
            }
            if let pt = obj["practiceType"] as? String, !pt.isEmpty {
                self.practiceTypeStr = pt
                UserDefaults.standard.set(pt, forKey: self.practiceTypePrefsKey)
            }
            if let bt = obj["bowType"] as? String, !bt.isEmpty {
                self.bowTypeStr = bt
            }
            if let perEnd = obj["arrowsPerEnd"] as? Int { self.arrowsPerEnd = max(1, perEnd) }
            if let ends = obj["endsCount"] as? Int { self.endsCount = max(1, ends) }
            if let sens = obj["sensitivityLevel"] as? Int {
                self.sensitivityLevel = max(0, min(2, sens))
                UserDefaults.standard.set(self.sensitivityLevel, forKey: "sensitivityLevel")
            }
            if let walked = obj["distanceWalkedM"] as? Double {
                self.distanceWalkedM = max(self.distanceWalkedM, walked)
            } else if let walkedInt = obj["distanceWalkedM"] as? Int {
                self.distanceWalkedM = max(self.distanceWalkedM, Double(walkedInt))
            }
            if let kcal = obj["activeKcal"] as? Int { self.syncedActiveKcal = kcal }

            let nextAnalysis = (obj["analysisMode"] as? Bool) ?? ((obj["practiceType"] as? String) == "Análisis")
            if self.analysisMode != nextAnalysis {
                self.analysisMode = nextAnalysis
                if !nextAnalysis {
                    self.manualAnalysisRecording = false
                    self.manualTimer?.invalidate()
                }
                self.syncShotDetectionMotionSensors()
            }

            if let cmdType = obj["type"] as? String {
                if cmdType == "ANALYSIS_MANUAL_START" {
                    self.startManualAnalysis(notifyPhone: false)
                } else if cmdType == "ANALYSIS_MANUAL_STOP" {
                    self.stopManualAnalysis(notifyPhone: false)
                } else if cmdType == "CALIBRATE_ZERO" || cmdType == "ANALYSIS_CALIBRATE_ZERO" {
                    self.calibrateZeroReference(notifyPhone: true)
                }
            }
        }
    }
}

// MARK: - SwiftUI Views (40mm/41mm Safe, >=34pt Tap Targets, Zero Truncation)

struct ArcheryWatchPagerView: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        TabView(selection: $vm.screenIndex) {
            CounterWatchScreen(vm: vm).tag(0)
            ScorePadWatchScreen(vm: vm).tag(1)
            BiometricsWatchScreen(vm: vm).tag(2)
            SummaryWatchScreen(vm: vm).tag(3)
            CloudCodeWatchScreen(vm: vm).tag(4)
        }
        .tabViewStyle(.page)
        .onAppear { vm.markUserActivity(isWriteAction: false) }
        .onPlayPauseCommand {
            vm.handleHardwarePrimaryAction()
        }
    }
}

struct WatchBrandHeaderView: View {
    let pillText: String
    var isYellowPill: Bool = false
    var isMutedPill: Bool = false
    var isAlertPill: Bool = false

    var body: some View {
        let accentColor: Color = {
            if isAlertPill { return Color(red: 1, green: 30/255, blue: 30/255) }
            if isMutedPill { return Color.white.opacity(0.35) }
            if isYellowPill { return Color(red: 1, green: 229/255, blue: 0) }
            return Color(red: 0/255, green: 168/255, blue: 243/255)
        }()
        let bgFill: Color = {
            if isAlertPill { return Color(red: 24/255, green: 7/255, blue: 9/255) }
            if isMutedPill { return Color(red: 10/255, green: 13/255, blue: 19/255) }
            if isYellowPill { return Color(red: 16/255, green: 16/255, blue: 6/255) }
            return Color(red: 4/255, green: 11/255, blue: 18/255)
        }()

        VStack(spacing: 3) {
            Image("brand_logo_full")
                .resizable()
                .scaledToFit()
                .frame(height: 10)
            HStack(spacing: 4) {
                Circle()
                    .fill(accentColor)
                    .frame(width: 4.5, height: 4.5)
                Text(pillText)
                    .font(.system(size: 8, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .allowsTightening(true)
            }
            .padding(.horizontal, 7)
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
        let syncedNow = vm.isPhoneConnected || vm.isCloudSynced
        if vm.analysisMode {
            VStack(spacing: 6) {
                WatchBrandHeaderView(
                    pillText: vm.manualAnalysisRecording
                        ? String(format: "%@ · %.1fs", vm.tr("GRABANDO", "REC"), vm.manualAnalysisElapsedSec)
                        : (vm.arrowCount > 0
                            ? "\(vm.tr("TIRO", "SHOT")) \(vm.arrowCount) · \(vm.distanceM)M"
                            : "\(vm.tr("ANÁLISIS · LISTO", "ANALYSIS · READY"))"),
                    isYellowPill: vm.manualAnalysisRecording,
                    isMutedPill: false
                )

                Text(
                    vm.manualAnalysisRecording
                        ? String(format: "%@ · %.1f s", vm.tr("EN CURSO", "ACTIVE"), vm.manualAnalysisElapsedSec)
                        : (vm.lastAnalysisStabPct > 0
                            ? "\(vm.tr("ESTABILIDAD", "STABILITY")) \(vm.lastAnalysisStabPct)%"
                            : vm.tr("PULSA INICIO PARA MEDIR", "TAP START TO MEASURE"))
                )
                .font(.system(size: 10.5, weight: .black, design: .rounded).monospacedDigit())
                .foregroundColor(vm.manualAnalysisRecording ? Color(red: 1, green: 229/255, blue: 0) : .white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 4)
                .frame(maxWidth: .infinity, minHeight: 36)
                .background(Color(red: 11/255, green: 14/255, blue: 21/255))
                .cornerRadius(9)
                .overlay(
                    RoundedRectangle(cornerRadius: 9)
                        .stroke(
                            vm.manualAnalysisRecording
                                ? Color(red: 1, green: 229/255, blue: 0).opacity(0.8)
                                : Color(red: 0, green: 191/255, blue: 1).opacity(0.6),
                            lineWidth: 1.1
                        )
                )

                HStack(spacing: 7) {
                    Button(action: { vm.startManualAnalysis(notifyPhone: true) }) {
                        Text(vm.tr("▶ INICIO", "▶ START"))
                            .font(.system(size: 11, weight: .black, design: .rounded))
                            .foregroundColor(vm.manualAnalysisRecording ? .white.opacity(0.55) : .black)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, minHeight: 38)
                            .background(
                                vm.manualAnalysisRecording
                                    ? Color(red: 9/255, green: 19/255, blue: 30/255)
                                    : Color(red: 0, green: 191/255, blue: 1)
                            )
                            .cornerRadius(11)
                    }
                    .buttonStyle(.plain)
                    .disabled(vm.manualAnalysisRecording)

                    Button(action: { vm.stopManualAnalysis(notifyPhone: true) }) {
                        Text(vm.tr("■ FINAL", "■ END"))
                            .font(.system(size: 11, weight: .black, design: .rounded))
                            .foregroundColor(vm.manualAnalysisRecording ? .white : .white.opacity(0.4))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, minHeight: 38)
                            .background(
                                vm.manualAnalysisRecording
                                    ? Color(red: 1, green: 30/255, blue: 30/255)
                                    : Color(red: 17/255, green: 21/255, blue: 30/255)
                            )
                            .cornerRadius(11)
                    }
                    .buttonStyle(.plain)
                    .disabled(!vm.manualAnalysisRecording)
                }
            }
            .padding(.horizontal, 8)
        } else {
            VStack(spacing: 5) {
                WatchBrandHeaderView(
                    pillText: vm.currentStatusPillLabel,
                    isYellowPill: vm.pendingQueueCount > 0 && !syncedNow,
                    isMutedPill: !syncedNow && vm.pendingQueueCount == 0
                )

                VStack(spacing: 3) {
                    Text(
                        vm.isScoredPractice
                            ? vm.tr("PUNTUACIÓN · FLECHAS", "SCORING · ARROWS")
                            : vm.tr("VOLUMEN · FLECHAS", "VOLUME · ARROWS")
                    )
                    .font(.system(size: 7.5, weight: .bold, design: .rounded))
                    .foregroundColor(.gray)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)

                    HStack(spacing: 4) {
                        ForEach(0..<4, id: \.self) { idx in
                            Text(digits[idx])
                                .font(.system(size: 20, weight: .black, design: .rounded).monospacedDigit())
                                .foregroundColor(idx == 3 ? Color(red: 1, green: 229/255, blue: 0) : .white)
                                .frame(maxWidth: .infinity, minHeight: 34)
                                .background(Color(red: 11/255, green: 14/255, blue: 21/255))
                                .cornerRadius(6)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(idx == 3 ? Color(red: 1, green: 229/255, blue: 0) : Color.white.opacity(0.14), lineWidth: 1)
                                )
                        }
                    }
                }
                .padding(5)
                .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                )
                .cornerRadius(10)

                HStack(spacing: 7) {
                    Button(action: { vm.incrementArrow(delta: -1) }) {
                        Text("−1")
                            .font(.system(size: 15, weight: .black, design: .rounded).monospacedDigit())
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity, minHeight: 38)
                            .background(Color(red: 24/255, green: 7/255, blue: 9/255))
                            .cornerRadius(11)
                            .overlay(
                                RoundedRectangle(cornerRadius: 11)
                                    .stroke(Color(red: 1, green: 30/255, blue: 30/255).opacity(0.78), lineWidth: 1.2)
                            )
                    }
                    .buttonStyle(.plain)

                    Button(action: { vm.incrementArrow(delta: 1) }) {
                        Text("+1")
                            .font(.system(size: 15, weight: .black, design: .rounded).monospacedDigit())
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity, minHeight: 38)
                            .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                            .cornerRadius(11)
                            .overlay(
                                RoundedRectangle(cornerRadius: 11)
                                    .stroke(Color(red: 0, green: 168/255, blue: 243/255), lineWidth: 1.2)
                            )
                    }
                    .buttonStyle(.plain)
                }

                VStack(spacing: 1) {
                    Text("\(vm.walkedPrimaryString) · \(vm.activeKcal) kcal")
                        .font(.system(size: 9.5, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text("\(vm.tr("TANDA", "END")) \(vm.currentEnd) · \(vm.distanceM) M")
                        .font(.system(size: 7.5, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundColor(.gray)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .onTapGesture {
                    vm.screenIndex = 2
                    vm.markUserActivity(isWriteAction: false)
                }
            }
            .padding(.horizontal, 8)
        }
    }
}

struct ScorePadWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel
    private let scoreKeys = ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"]

    private func fgColor(for key: String) -> Color {
        if ["X", "10", "9"].contains(key) {
            return Color(red: 1, green: 229/255, blue: 0)
        }
        if key == "M" {
            return Color(red: 203/255, green: 213/255, blue: 225/255)
        }
        return .white
    }

    private func bgColor(for key: String) -> Color {
        if ["X", "10", "9"].contains(key) {
            return Color(red: 18/255, green: 17/255, blue: 7/255)
        }
        if ["8", "7"].contains(key) {
            return Color(red: 22/255, green: 7/255, blue: 8/255)
        }
        if ["6", "5"].contains(key) {
            return Color(red: 6/255, green: 19/255, blue: 32/255)
        }
        return Color(red: 11/255, green: 14/255, blue: 21/255)
    }

    private func borderColor(for key: String) -> Color {
        if ["X", "10", "9"].contains(key) {
            return Color(red: 1, green: 229/255, blue: 0)
        }
        if ["8", "7"].contains(key) {
            return Color(red: 1, green: 30/255, blue: 30/255)
        }
        if ["6", "5"].contains(key) {
            return Color(red: 0, green: 168/255, blue: 243/255)
        }
        return Color(red: 71/255, green: 85/255, blue: 105/255)
    }

    var body: some View {
        let totalSlots = max(1, min(30, vm.arrowsPerEnd))
        let colsPerRow = min(6, totalSlots)
        let slotColumns = Array(repeating: GridItem(.flexible(), spacing: 3), count: colsPerRow)
        let endComplete = vm.currentEndArrows.count >= vm.arrowsPerEnd

        ScrollView(.vertical, showsIndicators: true) {
            VStack(spacing: 5) {
                Image("brand_logo_full")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 9.5)

                HStack(spacing: 4) {
                    Text("\(vm.tr("TANDA", "END")) \(vm.currentEnd)/\(vm.endsCount)")
                        .font(.system(size: 8.5, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                    Spacer(minLength: 2)
                    Text("\(vm.totalScore) PTS")
                        .font(.system(size: 9, weight: .black, design: .rounded).monospacedDigit())
                        .foregroundColor(Color(red: 1, green: 229/255, blue: 0))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Color(red: 5/255, green: 13/255, blue: 23/255))
                .overlay(
                    Capsule().stroke(Color(red: 0, green: 168/255, blue: 243/255).opacity(0.7), lineWidth: 1)
                )
                .clipShape(Capsule())

                // Displays ALL arrow slots even when arrowsPerEnd > 6 (wraps cleanly into rows of 6)
                LazyVGrid(columns: slotColumns, spacing: 3) {
                    ForEach(0..<totalSlots, id: \.self) { idx in
                        let filled = idx < vm.currentEndArrows.count
                        let val = filled ? vm.currentEndArrows[idx] : "–"
                        Text(val)
                            .font(.system(size: 9, weight: .heavy, design: .rounded).monospacedDigit())
                            .foregroundColor(filled ? fgColor(for: val) : .gray)
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                            .frame(maxWidth: .infinity, minHeight: 18)
                            .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                            .cornerRadius(4)
                            .overlay(
                                RoundedRectangle(cornerRadius: 4)
                                    .stroke(filled ? borderColor(for: val) : Color.white.opacity(0.16), lineWidth: 1)
                            )
                    }
                }

                if !vm.scorepadHintText.isEmpty {
                    Text(vm.scorepadHintText)
                        .font(.system(size: 8, weight: .heavy, design: .rounded))
                        .foregroundColor(Color(red: 1, green: 229/255, blue: 0))
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                }

                // XL 4x3 Score Grid (>= 34pt tactile height across all watch sizes)
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 4),
                        GridItem(.flexible(), spacing: 4),
                        GridItem(.flexible(), spacing: 4),
                        GridItem(.flexible(), spacing: 4)
                    ],
                    spacing: 4
                ) {
                    ForEach(scoreKeys, id: \.self) { key in
                        Button(action: { vm.recordScore(key) }) {
                            Text(key)
                                .font(.system(size: 16, weight: .black, design: .rounded).monospacedDigit())
                                .foregroundColor(fgColor(for: key))
                                .frame(maxWidth: .infinity, minHeight: 34)
                                .background(bgColor(for: key))
                                .cornerRadius(7)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7)
                                        .stroke(borderColor(for: key), lineWidth: 1.2)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }

                HStack(spacing: 5) {
                    Button(action: { vm.undoLastScore() }) {
                        Text(vm.tr("BORRAR", "DEL"))
                            .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(Color(red: 11/255, green: 14/255, blue: 21/255))
                            .overlay(
                                Capsule().stroke(Color(red: 71/255, green: 85/255, blue: 105/255), lineWidth: 1.1)
                            )
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)

                    Button(action: { vm.advanceToNextEnd() }) {
                        Text(vm.tr("SIG. TANDA", "NEXT END"))
                            .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                            .foregroundColor(endComplete ? .white : .white.opacity(0.5))
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(
                                endComplete
                                    ? Color(red: 6/255, green: 21/255, blue: 35/255)
                                    : Color(red: 11/255, green: 14/255, blue: 21/255)
                            )
                            .overlay(
                                Capsule().stroke(
                                    endComplete
                                        ? Color(red: 0, green: 168/255, blue: 243/255)
                                        : Color.white.opacity(0.2),
                                    lineWidth: 1.1
                                )
                            )
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 5)
            .padding(.bottom, 6)
        }
    }
}

struct BiometricsWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel

    private var hrStatusLabel: String {
        if vm.heartRateBpm >= 30 {
            return "\(vm.heartRateBpm) BPM"
        }
        switch vm.hrSensorStatus {
        case "permission_denied", "no_samples":
            return vm.tr("SIN PERMISO SALUD", "CHECK HEALTH ACCESS")
        case "unavailable":
            return vm.tr("SENSOR NO DISP.", "SENSOR N/A")
        case "connecting", "streaming":
            return vm.tr("MIDIENDO PULSO", "MEASURING HR")
        default:
            return vm.tr("TOCA PARA MEDIR", "TAP TO MEASURE")
        }
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 6) {
                WatchBrandHeaderView(
                    pillText: vm.tr("BIOMETRÍA · PASOS", "BIOMETRICS · STEPS"),
                    isYellowPill: true
                )

                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(vm.tr("PULSO EN VIVO", "LIVE HEART RATE"))
                            .font(.system(size: 7.5, weight: .bold, design: .rounded))
                            .foregroundColor(.gray)
                        Spacer()
                        if vm.avgHeartRateBpm >= 30 {
                            Text("\(vm.tr("PROM", "AVG")) \(vm.avgHeartRateBpm) · MÁX \(vm.maxHeartRateBpm)")
                                .font(.system(size: 7.5, weight: .heavy, design: .rounded).monospacedDigit())
                                .foregroundColor(Color(red: 1, green: 30/255, blue: 30/255))
                                .lineLimit(1)
                                .minimumScaleFactor(0.65)
                        }
                    }
                    Text(hrStatusLabel)
                        .font(.system(size: 13.5, weight: .black, design: .rounded).monospacedDigit())
                        .foregroundColor(vm.heartRateBpm >= 30 ? .white : Color.white.opacity(0.75))
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(7)
                .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                .cornerRadius(8)
                .onTapGesture {
                    vm.startHeartRateStreamingIfSupported()
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(vm.tr("DISTANCIA", "DISTANCE"))
                            .font(.system(size: 7.5, weight: .bold, design: .rounded))
                            .foregroundColor(.gray)
                        Spacer()
                        Text("\(vm.stepsCount) \(vm.tr("PASOS", "STEPS"))")
                            .font(.system(size: 7.5, weight: .heavy, design: .rounded).monospacedDigit())
                            .foregroundColor(Color(red: 0, green: 168/255, blue: 243/255))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    Text(vm.walkedDualString)
                        .font(.system(size: 13, weight: .black, design: .rounded).monospacedDigit())
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(7)
                .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                .cornerRadius(8)

                VStack(alignment: .leading, spacing: 2) {
                    Text(vm.tr("GASTO ENERGÉTICO", "ACTIVE ENERGY"))
                        .font(.system(size: 7.5, weight: .bold, design: .rounded))
                        .foregroundColor(.gray)
                    Text("\(vm.activeKcal) kcal")
                        .font(.system(size: 13.5, weight: .black, design: .rounded).monospacedDigit())
                        .foregroundColor(.white)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(7)
                .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                .cornerRadius(8)

                Button(action: { vm.syncTelemetryManual() }) {
                    Text(vm.tr("SINCRONIZAR", "SYNC NOW"))
                        .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                        .overlay(
                            Capsule().stroke(Color(red: 0, green: 168/255, blue: 243/255), lineWidth: 1.1)
                        )
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
        }
    }
}

struct SummaryWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        let syncedNow = vm.isPhoneConnected || vm.isCloudSynced || !vm.cloudSessionToken.isEmpty
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 6) {
                WatchBrandHeaderView(
                    pillText: syncedNow
                        ? vm.tr("RESUMEN · CONECTADO", "SUMMARY · SYNCED")
                        : vm.tr("RESUMEN · LOCAL", "SUMMARY · LOCAL"),
                    isMutedPill: !syncedNow
                )

                HStack(spacing: 5) {
                    VStack(spacing: 2) {
                        Text(vm.tr("FLECHAS", "ARROWS"))
                            .font(.system(size: 7.5, weight: .bold, design: .rounded))
                            .foregroundColor(.gray)
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                        Text("\(vm.arrowCount)")
                            .font(.system(size: 15, weight: .black, design: .rounded).monospacedDigit())
                            .foregroundColor(.white)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(6)
                    .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                    .cornerRadius(8)

                    VStack(spacing: 2) {
                        Text(vm.tr("PUNTAJE", "SCORE"))
                            .font(.system(size: 7.5, weight: .bold, design: .rounded))
                            .foregroundColor(.gray)
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                        Text("\(vm.totalScore)")
                            .font(.system(size: 15, weight: .black, design: .rounded).monospacedDigit())
                            .foregroundColor(Color(red: 1, green: 229/255, blue: 0))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(6)
                    .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                    .cornerRadius(8)
                }

                Text("\(vm.walkedPrimaryString) · \(vm.activeKcal) kcal")
                    .font(.system(size: 10, weight: .heavy, design: .rounded).monospacedDigit())
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Button(action: { vm.requestFinishSession() }) {
                    Text(vm.tr("GUARDAR SESIÓN", "SAVE SESSION"))
                        .font(.system(size: 10, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                        .overlay(
                            Capsule().stroke(Color(red: 0, green: 168/255, blue: 243/255), lineWidth: 1.2)
                        )
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
        }
        .confirmationDialog(
            vm.tr("¿Guardar y finalizar sesión?", "Save and finish session?"),
            isPresented: $vm.showFinishConfirmation,
            titleVisibility: .visible
        ) {
            Button(vm.tr("Confirmar y Guardar", "Confirm & Save")) {
                vm.confirmFinishSession()
            }
            Button(vm.tr("Cancelar", "Cancel"), role: .cancel) {}
        } message: {
            Text("\(vm.arrowCount) \(vm.tr("flechas", "arrows")) · \(vm.totalScore) pts")
        }
        .alert(
            vm.tr("Reloj sin vincular", "Watch Not Linked"),
            isPresented: $vm.showUnlinkedSaveWarning
        ) {
            Button(vm.tr("Vincular Código", "Link Code")) {
                vm.screenIndex = 4
            }
            Button(vm.tr("Descartar Local", "Discard Local"), role: .destructive) {
                vm.discardLocalUnlinkedSession()
            }
            Button(vm.tr("Cancelar", "Cancel"), role: .cancel) {}
        } message: {
            Text(
                vm.tr(
                    "Vincula tu reloj en la pantalla de Código Nube para enviar tus flechas y pasos antes de reiniciar.",
                    "Link your watch on the Cloud Code screen to sync your arrows and steps before resetting."
                )
            )
        }
    }
}

struct CloudCodeWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel
    @State private var crownAccumulator: Double = 500.0
    @State private var lastCrownStep: Int = 500

    var body: some View {
        let hasError = !vm.cloudStatusMessage.isEmpty
        let headerText: String = {
            if vm.isClaimingPairing {
                return vm.tr("VERIFICANDO CÓDIGO", "VERIFYING CODE")
            }
            if hasError {
                return vm.cloudStatusMessage
            }
            if vm.isEditingCode {
                return "\(vm.tr("EDITAR", "EDIT")) \(vm.editDigitPos + 1)/6"
            }
            if vm.isCloudSynced {
                return vm.tr("CÓDIGO NUBE · SYNC", "CLOUD CODE · SYNC")
            }
            return vm.hasPairingCode
                ? vm.tr("CÓDIGO NUBE", "CLOUD CODE")
                : vm.tr("INGRESA 6 DÍGITOS", "ENTER 6 DIGITS")
        }()

        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 6) {
                WatchBrandHeaderView(
                    pillText: headerText,
                    isYellowPill: vm.isEditingCode || vm.isClaimingPairing,
                    isMutedPill: !vm.isCloudSynced && !vm.isEditingCode && !hasError && !vm.isClaimingPairing,
                    isAlertPill: hasError
                )

                HStack(spacing: 3) {
                    ForEach(0..<6, id: \.self) { idx in
                        let isSel = (idx == vm.editDigitPos)
                        Button(action: {
                            if vm.editDigitPos == idx && vm.isEditingCode {
                                vm.adjustSelectedCodeDigit(delta: 1)
                            } else {
                                vm.editDigitPos = idx
                                vm.isEditingCode = true
                                vm.markUserActivity(isWriteAction: true)
                                WKInterfaceDevice.current().play(.click)
                            }
                        }) {
                            Text("\(vm.pairingDigits[idx])")
                                .font(.system(size: 16, weight: .black, design: .rounded).monospacedDigit())
                                .foregroundColor(isSel ? .white : Color(red: 1, green: 229/255, blue: 0))
                                .frame(maxWidth: .infinity, minHeight: 36)
                                .background(
                                    isSel
                                        ? Color(red: 8/255, green: 21/255, blue: 35/255)
                                        : Color(red: 11/255, green: 14/255, blue: 21/255)
                                )
                                .cornerRadius(6)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(
                                            isSel
                                                ? Color(red: 0, green: 168/255, blue: 243/255)
                                                : Color(red: 1, green: 229/255, blue: 0).opacity(0.8),
                                            lineWidth: 1.2
                                        )
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }

                HStack(spacing: 5) {
                    Button(action: { vm.adjustSelectedCodeDigit(delta: -1) }) {
                        Text("−")
                            .font(.system(size: 15, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .frame(minWidth: 38, minHeight: 34)
                            .background(Color(red: 24/255, green: 7/255, blue: 9/255))
                            .overlay(Capsule().stroke(Color(red: 1, green: 30/255, blue: 30/255), lineWidth: 1.1))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)

                    Button(action: {
                        vm.isEditingCode = true
                        vm.editDigitPos = (vm.editDigitPos + 1) % 6
                        vm.markUserActivity(isWriteAction: true)
                        WKInterfaceDevice.current().play(.click)
                    }) {
                        Text("\(vm.tr("DÍGITO", "DIGIT")) \(vm.editDigitPos + 1)/6")
                            .font(.system(size: 9, weight: .heavy, design: .rounded).monospacedDigit())
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(Color(red: 11/255, green: 14/255, blue: 21/255))
                            .overlay(Capsule().stroke(Color(red: 71/255, green: 85/255, blue: 105/255), lineWidth: 1.1))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)

                    Button(action: { vm.adjustSelectedCodeDigit(delta: 1) }) {
                        Text("+")
                            .font(.system(size: 15, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .frame(minWidth: 38, minHeight: 34)
                            .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                            .overlay(Capsule().stroke(Color(red: 0, green: 168/255, blue: 243/255), lineWidth: 1.1))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }

                Button(action: { vm.commitPairingDigits() }) {
                    Text(
                        vm.isClaimingPairing
                            ? vm.tr("VINCULANDO", "LINKING")
                            : (vm.isEditingCode || !vm.isCloudSynced
                                ? vm.tr("VINCULAR CÓDIGO", "LINK CODE")
                                : vm.tr("VINCULADO · RENOVAR", "SYNCED · REFRESH"))
                    )
                    .font(.system(size: 9.5, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .frame(maxWidth: .infinity, minHeight: 35)
                    .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                    .overlay(
                        Capsule().stroke(
                            vm.isCloudSynced
                                ? Color(red: 1, green: 229/255, blue: 0)
                                : Color(red: 0, green: 168/255, blue: 243/255),
                            lineWidth: 1.2
                        )
                    )
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(vm.isClaimingPairing)

                if vm.hasPairingCode || !vm.cloudSessionToken.isEmpty {
                    Button(action: { vm.unlinkCloudSession() }) {
                        Text(vm.tr("DESVINCULAR", "UNLINK"))
                            .font(.system(size: 9, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(Color(red: 24/255, green: 7/255, blue: 9/255))
                            .overlay(
                                Capsule().stroke(Color(red: 1, green: 30/255, blue: 30/255).opacity(0.7), lineWidth: 1)
                            )
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
        }
        .focusable(true)
        .digitalCrownRotation(
            $crownAccumulator,
            from: 0.0,
            through: 1000.0,
            by: 1.0,
            sensitivity: .medium,
            isContinuous: true,
            isHapticFeedbackEnabled: true
        )
        .onChange(of: crownAccumulator) { newValue in
            let step = Int(newValue.rounded())
            let rawDiff = step - lastCrownStep
            if rawDiff != 0 {
                lastCrownStep = step
                let normalizedDiff = abs(rawDiff) > 500
                    ? (rawDiff > 0 ? rawDiff - 1000 : rawDiff + 1000)
                    : rawDiff
                vm.adjustSelectedCodeDigit(delta: normalizedDiff > 0 ? 1 : -1)
            }
        }
    }
}
