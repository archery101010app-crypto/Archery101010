import SwiftUI
import Foundation
import WatchConnectivity
import CoreMotion
import AVFoundation
import HealthKit
import WatchKit

/// ARCHERY 101010 — Official WatchOS Companion App (`watchOS 10+`)
/// Matte OLED Design DNA:
///  - Official 4K Retina Brand Logo (`brand_logo_full`) at 100% full luminance
///  - Tabular Athletic Numerals (`Outfit` / Rounded Tabular)
///  - Bilingual ES/EN + Metric/Imperial Regional Units
///  - 5 Screens synchronized in real time via `WatchConnectivity` + 6-Digit Cloud Code:
///      0: 4-Digit Counter (`0 0 0 0`) + Auto-Shot + Walked Distance & `kcal`
///      1: XL 4x3 Scorepad (`X, 10..1, M`) + Slots + `BORRAR`/`DEL` & `SIG. TANDA`/`NEXT END`
///      2: Biometrics (`DISTANCIA`/`DISTANCE` + `PASOS`/`STEPS` + `kcal`)
///      3: Session Summary + `GUARDAR`/`SAVE`
///      4: 6-Digit Cloud Code (`CÓDIGO NUBE`/`CLOUD CODE`)
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
    @Published var screenIndex: Int = 0 {
        didSet {
            if screenIndex != oldValue {
                markUserActivity(isWriteAction: false)
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
    @Published var stepsCount: Int = 0
    @Published var distanceWalkedM: Double = 0.0
    @Published var syncedActiveKcal: Int = -1
    @Published var heartRateBpm: Int = 0
    @Published var avgHeartRateBpm: Int = 0
    @Published var maxHeartRateBpm: Int = 0
    @Published var autoDetectEnabled: Bool = false
    @Published var analysisMode: Bool = false
    @Published var manualAnalysisRecording: Bool = false
    @Published var manualAnalysisElapsedSec: Double = 0.0
    @Published var lastAnalysisStabPct: Int = 0
    var bowTypeStr: String = "Barebow"
    var bowWristStr: String = "LEFT"
    private var manualAnalysisStartMs: Int64 = 0
    private var manualTimer: Timer?
    private var lastHandledStartAt: Int64 = 0
    private var lastHandledStopAt: Int64 = 0
    @Published var sensitivityLevel: Int = 1 // 0: BAJA/LOW, 1: MEDIA/MED, 2: ALTA/HIGH
    @Published var isWalkingPaused: Bool = false
    @Published var isPhoneConnected: Bool = false

    // 6-Digit Cloud Sync state
    @Published var pairingDigits: [Int] = [1, 0, 1, 0, 1, 0]
    @Published var hasPairingCode: Bool = false
    @Published var pairingCode: String = ""
    @Published var isEditingCode: Bool = false
    @Published var editDigitPos: Int = 0
    @Published var isCloudSynced: Bool = false

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

    func tr(_ es: String, _ en: String) -> String {
        return isSpanish ? es : en
    }

    private let motionManager = CMMotionManager()
    private let pedometer = CMPedometer()
    private let audioEngine = AVAudioEngine()
    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var heartRateQuery: HKAnchoredObjectQuery?
    private var hrSampleSum: Int = 0
    private var hrSampleCount: Int = 0
    private var lastHrPhoneSendMs: Int64 = 0
    private var lastHrCloudPushMs: Int64 = 0
    private var isAcousticTapInstalled: Bool = false
    private var lastVerifiedAcousticSnapMs: Int64 = 0
    @Published var micDeniedNotice: Bool = false
    private var audioPrevSample: Float = 0.0
    private var audioNoiseFloorRms: Double = 0.0035
    private var audioWarmupFrames: Int = 0
    private var audioInCandidate: Bool = false
    private var audioCandidateStartMs: Int64 = 0
    private var audioCandidatePeakRms: Double = 0.0
    private var audioSustainedFrames: Int = 0
    private var audioWaitQuietReset: Bool = false
    private var hasHardwarePedometer: Bool = false
    private var currentSessionId: String = ""
    private var lastShotTimeMs: Int64 = 0
    private var lastStepTimeMs: Int64 = 0
    private var prevStepTimeMs: Int64 = 0
    private var recentStepBoutCount: Int = 0
    private var walkingLockUntilMs: Int64 = 0
    private var smoothedMagG: Double = 1.0

    // 7-Gate 3D + Gyro Biomechanical Ring Buffer (40Hz)
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

    // Post-release 220ms follow-through verification
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
        autoDetectEnabled = false
        defaults.set(false, forKey: "autoDetectEnabled_v2")
        if defaults.object(forKey: "sensitivityLevel") != nil {
            sensitivityLevel = max(0, min(2, defaults.integer(forKey: "sensitivityLevel")))
        }
        currentSessionId = defaults.string(forKey: "currentSessionId") ?? ""
        if let savedCode = defaults.string(forKey: "pairingCode"), savedCode.count == 6 {
            pairingCode = savedCode
            hasPairingCode = true
            parsePairingDigits(savedCode)
        }
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
        startSensors()
        if hasPairingCode && pairingCode.count == 6 {
            pollFirestoreCloud()
        }
        startCloudPollingTimer()
    }

    deinit {
        cloudPollTimer?.invalidate()
        stopHeartRateStreaming()
    }

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
        heartRateBpm = 0
        avgHeartRateBpm = 0
        maxHeartRateBpm = 0
        hrSampleSum = 0
        hrSampleCount = 0
        accelCandidateStepT.removeAll()
        accelRhythmicCadenceActive = false
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

    private func isTrueArcheryAnchor(
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

        for s in motionBuf.reversed() {
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
        isWalkingPaused = true
    }

    private func evaluateFallbackRhythmicStep(nowMs: Int64) -> Int {
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

    func cycleSensitivityMode() {
        // 100% Manual Counter Mode on watches
        autoDetectEnabled = false
        UserDefaults.standard.set(false, forKey: "autoDetectEnabled_v2")
        syncShotDetectionMotionSensors()
        markUserActivity(isWriteAction: false)
    }

    var currentStatusPillLabel: String {
        let syncedNow = isPhoneConnected || isCloudSynced
        return syncedNow ? tr("CONECTADO · LIVE", "SYNCED · LIVE") : tr("MODO MANUAL", "MANUAL MODE")
    }

    private func startSensors() {
        restartPedometerFromNow()
        syncShotDetectionMotionSensors()
        startHeartRateStreamingIfSupported()
    }

    private func startHeartRateStreamingIfSupported() {
        guard HKHealthStore.isHealthDataAvailable(),
              let hrType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            sendHeartRateStatusToPhone(bpm: 0, status: "no_sensor")
            return
        }
        let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
        let readTypes: Set<HKObjectType> = [hrType]
        healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { [weak self] granted, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard granted else {
                    self.sendHeartRateStatusToPhone(bpm: 0, status: "permission_denied")
                    return
                }
                self.beginWorkoutAndHeartRateQuery(hrType: hrType)
            }
        }
    }

    private func beginWorkoutAndHeartRateQuery(hrType: HKQuantityType) {
        if workoutSession == nil {
            let config = HKWorkoutConfiguration()
            config.activityType = .archery
            config.locationType = .outdoor
            if let session = try? HKWorkoutSession(healthStore: healthStore, configuration: config) {
                workoutSession = session
                session.startActivity(with: Date())
            }
        }
        if let existingQuery = heartRateQuery {
            healthStore.stop(existingQuery)
            heartRateQuery = nil
        }
        let predicate = HKQuery.predicateForSamples(
            withStart: Date().addingTimeInterval(-30),
            end: nil,
            options: .strictStartDate
        )
        let query = HKAnchoredObjectQuery(
            type: hrType,
            predicate: predicate,
            anchor: nil,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, _, _ in
            self?.handleHeartRateSamples(samples)
        }
        query.updateHandler = { [weak self] _, samples, _, _, _ in
            self?.handleHeartRateSamples(samples)
        }
        heartRateQuery = query
        healthStore.execute(query)
    }

    private func stopHeartRateStreaming() {
        if let q = heartRateQuery {
            healthStore.stop(q)
            heartRateQuery = nil
        }
        if let ws = workoutSession {
            ws.end()
            workoutSession = nil
        }
    }

    private func handleHeartRateSamples(_ samples: [HKSample]?) {
        guard let quantitySamples = samples as? [HKQuantitySample],
              let latest = quantitySamples.last else { return }
        let bpmUnit = HKUnit.count().unitDivided(by: HKUnit.minute())
        let bpm = Int(round(latest.quantity.doubleValue(for: bpmUnit)))
        guard bpm >= 30 && bpm <= 245 else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.heartRateBpm = bpm
            self.hrSampleSum += bpm
            self.hrSampleCount += 1
            self.avgHeartRateBpm = Int(round(Double(self.hrSampleSum) / Double(max(1, self.hrSampleCount))))
            if bpm > self.maxHeartRateBpm {
                self.maxHeartRateBpm = bpm
            }
            let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
            if (nowMs - self.lastHrPhoneSendMs) >= 1_000 {
                self.lastHrPhoneSendMs = nowMs
                self.sendHeartRateStatusToPhone(bpm: bpm, status: "ok")
            }
            // Also push live HR to 6-digit Cloud Sync (enables Apple Watch -> Android or Web!)
            if self.hasPairingCode && self.pairingCode.count == 6 && (nowMs - self.lastHrCloudPushMs) >= 4_500 {
                self.lastHrCloudPushMs = nowMs
                self.syncWithFirestoreCloud(eventType: "SYNC_TELEMETRY_FROM_WATCH", extraValue: nil)
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
            "deviceName": WKInterfaceDevice.current().name,
            "_ts": nowMs
        ]
        if avgHeartRateBpm >= 30 { msg["avgHeartRateBpm"] = avgHeartRateBpm }
        if maxHeartRateBpm >= 30 { msg["maxHeartRateBpm"] = maxHeartRateBpm }
        session.sendMessage(msg, replyHandler: nil, errorHandler: nil)
    }

    private func stopAcousticSnapEngine() {
        if isAcousticTapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            isAcousticTapInstalled = false
        }
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        lastVerifiedAcousticSnapMs = 0
        audioInCandidate = false
    }

    private func startAcousticSnapEngineIfPermitted() {
        guard autoDetectEnabled, !isAcousticTapInstalled else { return }
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard granted else {
                    self.autoDetectEnabled = false
                    self.micDeniedNotice = true
                    UserDefaults.standard.set(false, forKey: "autoDetectEnabled_v2")
                    self.syncShotDetectionMotionSensors()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4.5) {
                        self.micDeniedNotice = false
                    }
                    return
                }
                guard self.autoDetectEnabled, !self.isAcousticTapInstalled else { return }
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.record, mode: .measurement, options: [])
                    try session.setActive(true)
                    let inputNode = self.audioEngine.inputNode
                    let fmt = inputNode.outputFormat(forBus: 0)
                    guard fmt.sampleRate > 0 else { return }
                    self.audioWarmupFrames = 0
                    self.audioNoiseFloorRms = 0.0035
                    self.audioPrevSample = 0.0
                    self.audioInCandidate = false
                    self.audioWaitQuietReset = false

                    inputNode.installTap(onBus: 0, bufferSize: 256, format: fmt) { [weak self] buffer, _ in
                        guard let self = self,
                              let ch = buffer.floatChannelData?[0] else { return }
                        let count = Int(buffer.frameLength)
                        guard count > 0 else { return }
                        var sumSq: Double = 0.0
                        var maxAbs: Double = 0.0
                        var prev = self.audioPrevSample
                        for i in 0..<count {
                            let s = ch[i]
                            // High-pass differentiator (>1.6 kHz) isolates crisp bowstring snap
                            let hp = s - (0.88 * prev)
                            prev = s
                            let a = Double(abs(hp))
                            if a > maxAbs { maxAbs = a }
                            sumSq += Double(hp) * Double(hp)
                        }
                        self.audioPrevSample = prev
                        let hfRms = sqrt(sumSq / Double(count))
                        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)

                        if self.audioWarmupFrames < 8 {
                            let clamped = max(0.0008, min(0.08, hfRms))
                            self.audioNoiseFloorRms = (self.audioWarmupFrames == 0)
                                ? clamped
                                : (0.75 * self.audioNoiseFloorRms + 0.25 * clamped)
                            self.audioWarmupFrames += 1
                            return
                        }

                        let sens = self.sensitivityLevel
                        let snrMult = (sens == 0) ? 4.6 : ((sens == 2) ? 2.8 : 3.6)
                        let minRms = (sens == 0) ? 0.0042 : ((sens == 2) ? 0.0019 : 0.0028)
                        let crestMin = (sens == 0) ? 2.20 : ((sens == 2) ? 1.82 : 2.00)

                        if self.audioWaitQuietReset {
                            if hfRms < max(minRms * 0.85, self.audioNoiseFloorRms * 1.75) {
                                self.audioWaitQuietReset = false
                            } else {
                                self.audioNoiseFloorRms = max(0.0008, min(0.10, 0.985 * self.audioNoiseFloorRms + 0.015 * hfRms))
                                return
                            }
                        }

                        if !self.audioInCandidate {
                            let trigger = max(minRms, self.audioNoiseFloorRms * snrMult)
                            if hfRms >= trigger && maxAbs >= (hfRms * crestMin) {
                                self.audioInCandidate = true
                                self.audioCandidateStartMs = nowMs
                                self.audioCandidatePeakRms = hfRms
                                self.audioSustainedFrames = 1
                            } else if hfRms < self.audioNoiseFloorRms * 2.1 {
                                self.audioNoiseFloorRms = max(0.0008, min(0.10, 0.965 * self.audioNoiseFloorRms + 0.035 * hfRms))
                            }
                        } else {
                            if hfRms > self.audioCandidatePeakRms {
                                self.audioCandidatePeakRms = hfRms
                            }
                            if hfRms > self.audioCandidatePeakRms * 0.52 {
                                self.audioSustainedFrames += 1
                                if self.audioSustainedFrames > 8 {
                                    self.audioInCandidate = false
                                    self.audioWaitQuietReset = true
                                }
                            } else {
                                self.lastVerifiedAcousticSnapMs = self.audioCandidateStartMs
                                self.audioInCandidate = false
                            }
                        }
                    }
                    self.isAcousticTapInstalled = true
                    try self.audioEngine.start()
                    self.startInertial100HzSensors()
                } catch {
                    self.stopAcousticSnapEngine()
                }
            }
        }
    }

    private func syncShotDetectionMotionSensors() {
        if analysisMode {
            stopAcousticSnapEngine()
            startInertial100HzSensors()
            return
        }
        guard autoDetectEnabled else {
            pendingShotActive = false
            isWalkingPaused = false
            stopAcousticSnapEngine()
            if motionManager.isGyroActive {
                motionManager.stopGyroUpdates()
            }
            if motionManager.isAccelerometerActive {
                motionManager.stopAccelerometerUpdates()
            }
            motionBuf.removeAll()
            return
        }

        startAcousticSnapEngineIfPermitted()
    }

    private func startInertial100HzSensors() {
        guard autoDetectEnabled || analysisMode else { return }

        if motionManager.isGyroAvailable && !motionManager.isGyroActive {
            motionManager.gyroUpdateInterval = 0.01 // 100 Hz
            motionManager.startGyroUpdates(to: .main) { [weak self] data, _ in
                guard let self = self, let rot = data?.rotationRate else { return }
                self.latestGyroRad = sqrt(rot.x * rot.x + rot.y * rot.y + rot.z * rot.z)
                self.lastGyroMs = Int64(Date().timeIntervalSince1970 * 1000)
            }
        }

        if motionManager.isAccelerometerAvailable && !motionManager.isAccelerometerActive {
            motionManager.accelerometerUpdateInterval = 0.01 // 100 Hz
            motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
                guard let self = self, let acc = data?.acceleration else { return }
                let magG = sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z)
                let dynamicG = magG - self.smoothedMagG
                self.smoothedMagG = (0.95 * self.smoothedMagG) + (0.05 * magG)
                let linearG = abs(magG - 1.0)
                let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
                let activeGyro = ((nowMs - self.lastGyroMs) <= 140) ? self.latestGyroRad : -1.0

                // Sensitive gait / bow-carry cadence lock
                let sigG = max(linearG, abs(dynamicG))
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
                                self.isWalkingPaused = true
                            }
                        }
                    }
                }
                self.prevPrevSigG = self.prevSigG
                self.prevSigG = sigG

                if self.isWalkingPaused && nowMs >= self.walkingLockUntilMs {
                    self.isWalkingPaused = false
                }

                // Fallback rhythmic walking detector ONLY when hardware pedometer is unavailable
                if !self.hasHardwarePedometer
                    && dynamicG >= 0.14
                    && dynamicG <= 1.15
                    && (nowMs - self.lastStepTimeMs) > 380
                    && (nowMs - self.lastShotTimeMs) > 1500 {
                    let addedSteps = self.evaluateFallbackRhythmicStep(nowMs: nowMs)
                    if addedSteps > 0 {
                        self.recordDetectedStep(nowMs: nowMs, stepDelta: addedSteps)
                        self.stepsCount += addedSteps
                        self.distanceWalkedM = max(self.distanceWalkedM, Double(self.stepsCount) * 0.76)
                        self.maybeSyncTelemetryToPhone()
                    }
                }

                let thresholdG = (self.sensitivityLevel == 0) ? 2.35 : ((self.sensitivityLevel == 2) ? 1.55 : 1.92)
                let minJerkG = (self.sensitivityLevel == 0) ? 1.38 : ((self.sensitivityLevel == 2) ? 0.94 : 1.14)
                let quietMeanG = (self.sensitivityLevel == 0) ? 0.053 : ((self.sensitivityLevel == 2) ? 0.082 : 0.066)
                let quietPeakG = (self.sensitivityLevel == 0) ? 0.112 : ((self.sensitivityLevel == 2) ? 0.158 : 0.132)
                let preRampG = (self.sensitivityLevel == 0) ? 0.051 : ((self.sensitivityLevel == 2) ? 0.078 : 0.063)
                let axisSpanG = (self.sensitivityLevel == 0) ? 0.158 : ((self.sensitivityLevel == 2) ? 0.224 : 0.188)
                let gyroMeanMax = (self.sensitivityLevel == 0) ? 0.25 : ((self.sensitivityLevel == 2) ? 0.40 : 0.32)
                let gyroPeakMax = (self.sensitivityLevel == 0) ? 0.65 : ((self.sensitivityLevel == 2) ? 0.95 : 0.78)
                let stillWindowMs: Int64 = (self.sensitivityLevel == 0) ? 1550 : ((self.sensitivityLevel == 2) ? 1050 : 1300)
                let cooldownMs: Int64 = (self.sensitivityLevel == 0) ? 7000 : ((self.sensitivityLevel == 2) ? 5000 : 6000)
                let isWalkingBlocked = (nowMs < self.walkingLockUntilMs) || ((nowMs - self.lastStepTimeMs) < 4800)

                if self.pendingShotActive {
                    if !self.autoDetectEnabled || isWalkingBlocked {
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
                            // Dual-Key Coincidence Gate:
                            // Key 1 = 100 Hz Biomechanical Aim/Anchor + Release Impulse + Clean Follow-Through
                            // Key 2 = Synchronized High-Frequency Percussive String-Snap on Watch Microphone (±140ms)
                            let snapDeltaMs = abs(self.lastVerifiedAcousticSnapMs - self.pendingShotStartMs)
                            let hasAcousticKey = self.isAcousticTapInstalled
                                && self.lastVerifiedAcousticSnapMs > 0
                                && snapDeltaMs <= 140
                            if validFollow && hasAcousticKey && (nowMs - self.lastShotTimeMs) > cooldownMs {
                                self.lastShotTimeMs = nowMs
                                self.lastVerifiedAcousticSnapMs = 0
                                self.incrementArrow(delta: 1, source: "watch_auto")
                            }
                        }
                    }
                } else if self.autoDetectEnabled
                    && !isWalkingBlocked
                    && linearG >= thresholdG
                    && (nowMs - self.lastShotTimeMs) > cooldownMs {
                    var maxJump = 0.0
                    let cnt = self.motionBuf.count
                    for k in 1...3 where cnt - k >= 0 {
                        maxJump = max(maxJump, abs(magG - self.motionBuf[cnt - k].magG))
                    }
                    if maxJump >= minJerkG && self.isTrueArcheryAnchor(
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

                self.motionBuf.append(MotionSample(
                    t: nowMs,
                    ax: acc.x,
                    ay: acc.y,
                    az: acc.z,
                    magG: magG,
                    linG: linearG,
                    gyroRad: activeGyro
                ))
                if self.motionBuf.count > 3000 {
                    self.motionBuf.removeFirst(self.motionBuf.count - 3000)
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
        let kcalPerArrow = 0.56 + (max(15.0, bowPoundageLbs) * 0.0165)
        let walkKcal = (Double(walkedMetersInt) / 1000.0) * 72.0 * 0.78
        return Int(round(Double(arrowCount) * kcalPerArrow + walkKcal))
    }

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
        let cur = pairingDigits[editDigitPos]
        if editDigitPos == 0 {
            var nextFirst = cur + delta
            if nextFirst > 9 { nextFirst = 1 }
            if nextFirst < 1 { nextFirst = 9 }
            pairingDigits[0] = nextFirst
        } else {
            pairingDigits[editDigitPos] = (cur + delta + 10) % 10
        }
        isEditingCode = true
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.click)
    }

    func commitPairingDigits() {
        let built = pairingDigits.map { String($0) }.joined()
        pairingCode = built
        hasPairingCode = true
        isEditingCode = false
        lastRemoteStateSig = ""
        markUserActivity(isWriteAction: true)
        UserDefaults.standard.set(built, forKey: "pairingCode")
        WKInterfaceDevice.current().play(.success)
        pollFirestoreCloud()
        syncWithFirestoreCloud(eventType: "SYNC_TELEMETRY_FROM_WATCH", extraValue: nil)
        scheduleNextCloudPoll()
    }

    private func currentAdaptivePollIntervalMs(nowMs: Int64) -> Int64 {
        let idleMs = max(0, nowMs - lastActivityMs)
        // 3-Tier Adaptive Cloud Polling:
        // Active (< 90s): 8,000 ms | Warm Idle (90s..5m): 20,000 ms | Deep Idle (>= 5m): 45,000 ms
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
                if self.hasPairingCode && self.pairingCode.count == 6 && !self.isEditingCode {
                    self.pollFirestoreCloud()
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
        } else if hasPairingCode && pairingCode.count == 6 && !isEditingCode && (nowMs - lastLocalActionMs) >= 3_500 {
            if lastCloudPollMs == 0 || (nowMs - lastCloudPollMs) >= 8_000 {
                pollFirestoreCloud()
            }
        }
        scheduleNextCloudPoll()
    }

    private func startCloudPollingTimer() {
        scheduleNextCloudPoll()
    }

    private func syncWithFirestoreCloud(eventType: String, extraValue: String?) {
        guard hasPairingCode, pairingCode.count == 6 else { return }
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        cmdSequence += 1
        let cmdId = "wos-\(nowMs)-\(cmdSequence)"

        var cmdFields: [String: Any] = [
            "type": ["stringValue": eventType],
            "cmdId": ["stringValue": cmdId],
            "_cmdId": ["stringValue": cmdId],
            "_ts": ["integerValue": "\(nowMs)"]
        ]
        if eventType == "INCREMENT_ARROW" {
            cmdFields["delta"] = ["integerValue": "1"]
            cmdFields["source"] = ["stringValue": extraValue ?? "watch_manual"]
            if heartRateBpm >= 30 && heartRateBpm <= 245 {
                cmdFields["heartRateBpm"] = ["integerValue": "\(heartRateBpm)"]
            }
        } else if eventType == "DECREMENT_ARROW" {
            cmdFields["delta"] = ["integerValue": "-1"]
            cmdFields["source"] = ["stringValue": "watch_manual"]
            cmdFields["totalScore"] = ["integerValue": "\(totalScore)"]
        } else if eventType == "SCORE_INPUT", let val = extraValue {
            cmdFields["value"] = ["stringValue": val]
            cmdFields["totalScore"] = ["integerValue": "\(totalScore)"]
        } else if eventType == "UNDO_ARROW" {
            cmdFields["totalScore"] = ["integerValue": "\(totalScore)"]
        } else if eventType == "TOGGLE_AUTO_DETECT" {
            cmdFields["enabled"] = ["booleanValue": autoDetectEnabled]
            cmdFields["sensitivityLevel"] = ["integerValue": "\(sensitivityLevel)"]
        } else if eventType == "ANALYSIS_MANUAL_START" || eventType == "ANALYSIS_MANUAL_STOP" {
            cmdFields["ts"] = ["integerValue": "\(nowMs)"]
            cmdFields["source"] = ["stringValue": "watch_manual"]
        } else if eventType == "ANALYSIS_SHOT", let shotJson = extraValue {
            cmdFields["analysisShotJson"] = ["stringValue": shotJson]
            if heartRateBpm >= 30 && heartRateBpm <= 245 {
                cmdFields["heartRateBpm"] = ["integerValue": "\(heartRateBpm)"]
            }
        } else if eventType == "SYNC_TELEMETRY_FROM_WATCH" {
            cmdFields["stepsCount"] = ["integerValue": "\(stepsCount)"]
            cmdFields["distanceWalkedM"] = ["integerValue": "\(walkedMetersInt)"]
            cmdFields["activeKcal"] = ["integerValue": "\(activeKcal)"]
            if heartRateBpm >= 30 && heartRateBpm <= 245 {
                cmdFields["heartRateBpm"] = ["integerValue": "\(heartRateBpm)"]
            }
            if avgHeartRateBpm >= 30 && avgHeartRateBpm <= 245 {
                cmdFields["avgHeartRateBpm"] = ["integerValue": "\(avgHeartRateBpm)"]
            }
            if maxHeartRateBpm >= 30 && maxHeartRateBpm <= 245 {
                cmdFields["maxHeartRateBpm"] = ["integerValue": "\(maxHeartRateBpm)"]
            }
        }

        var docFields: [String: Any] = [
            "lastWatchCmd": ["mapValue": ["fields": cmdFields]],
            "lastWatchCmdId": ["stringValue": cmdId],
            "lastWatchCmdSeq": ["integerValue": "\(cmdSequence)"],
            "watchStepsCount": ["integerValue": "\(stepsCount)"],
            "watchDistanceM": ["integerValue": "\(walkedMetersInt)"],
            "watchHeartbeatAt": ["integerValue": "\(nowMs)"],
            "watchSource": ["stringValue": "WATCHOS"],
            "updatedAt": ["integerValue": "\(nowMs)"]
        ]
        var maskPaths = [
            "lastWatchCmd", "lastWatchCmdId", "lastWatchCmdSeq",
            "watchStepsCount", "watchDistanceM", "watchHeartbeatAt",
            "watchSource", "updatedAt"
        ]
        if heartRateBpm >= 30 && heartRateBpm <= 245 {
            docFields["watchHeartRateBpm"] = ["integerValue": "\(heartRateBpm)"]
            maskPaths.append("watchHeartRateBpm")
        }
        if avgHeartRateBpm >= 30 && avgHeartRateBpm <= 245 {
            docFields["watchAvgHeartRateBpm"] = ["integerValue": "\(avgHeartRateBpm)"]
            maskPaths.append("watchAvgHeartRateBpm")
        }
        if maxHeartRateBpm >= 30 && maxHeartRateBpm <= 245 {
            docFields["watchMaxHeartRateBpm"] = ["integerValue": "\(maxHeartRateBpm)"]
            maskPaths.append("watchMaxHeartRateBpm")
        }

        let maskQuery = maskPaths.map { "updateMask.fieldPaths=\($0)" }.joined(separator: "&")
        let urlStr = "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/\(pairingCode)?\(maskQuery)&currentDocument.exists=true"
        guard let url = URL(string: urlStr),
              let body = try? JSONSerialization.data(withJSONObject: ["fields": docFields]) else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("PATCH", forHTTPHeaderField: "X-HTTP-Method-Override")
        req.httpBody = body

        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            guard let self = self, let http = resp as? HTTPURLResponse else { return }
            let ok = (200..<300).contains(http.statusCode)
            DispatchQueue.main.async {
                if self.isCloudSynced != ok {
                    self.isCloudSynced = ok
                }
            }
        }.resume()
    }

    func pollFirestoreCloud() {
        guard hasPairingCode, pairingCode.count == 6,
              let url = URL(string: "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/\(pairingCode)") else { return }
        lastCloudPollMs = Int64(Date().timeIntervalSince1970 * 1000)

        URLSession.shared.dataTask(with: url) { [weak self] data, resp, _ in
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
                    let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
                    let fsArrows = fsInt("arrowsCount", self.arrowCount)
                    let fsScore = fsInt("totalScore", self.totalScore)
                    let fsEnd = max(1, fsInt("currentEnd", self.currentEnd))
                    let fsDistM = fsInt("distanceM", self.distanceM)
                    let fsPerEnd = max(1, fsInt("arrowsPerEnd", self.arrowsPerEnd))
                    let fsEnds = max(1, fsInt("totalEnds", self.endsCount))
                    let hasAutoField = fields["autoDetectEnabled"] != nil
                    let fsAuto = fsBool("autoDetectEnabled", self.autoDetectEnabled)
                    let fsSens = max(0, min(2, fsInt("sensitivityLevel", self.sensitivityLevel)))
                    let ptStr = ((fields["practiceType"] as? [String: Any])?["stringValue"] as? String) ?? ""
                    let fsAnalysis = fsBool("analysisMode", ptStr == "Análisis")
                    let calJson = ((fields["analysisCalibrationJson"] as? [String: Any])?["stringValue"] as? String) ?? ""

                    // Detect genuine remote cloud state changes to immediately resume Active Tier
                    let remoteSig = "\(sessionActive ? 1 : 0)|\(incomingSid)|\(fsArrows)|\(fsScore)|\(fsEnd)|\(endArrowsJoined)|\(fsDistM)|\(fsPerEnd)|\(fsEnds)|\(fsAuto ? 1 : 0)|\(fsSens)"
                    if self.lastRemoteStateSig.isEmpty {
                        self.lastRemoteStateSig = remoteSig
                    } else if self.lastRemoteStateSig != remoteSig {
                        self.lastRemoteStateSig = remoteSig
                        self.lastActivityMs = nowMs
                        self.scheduleNextCloudPoll()
                    }

                    let recentlyTapped = (nowMs - self.lastLocalActionMs) < 3_500
                    if !sessionActive {
                        if !recentlyTapped && (self.arrowCount > 0 || self.totalScore > 0 || self.stepsCount > 0) {
                            self.resetSessionCounters(newSessionId: "")
                        }
                        return
                    }
                    if !incomingSid.isEmpty && !self.currentSessionId.isEmpty && incomingSid != self.currentSessionId {
                        self.resetSessionCounters(newSessionId: incomingSid)
                    } else if !incomingSid.isEmpty && self.currentSessionId.isEmpty {
                        self.currentSessionId = incomingSid
                    }
                    if !recentlyTapped {
                        self.arrowCount = fsArrows
                        self.totalScore = fsScore
                        self.currentEnd = fsEnd
                        if hasEndArrowsField {
                            self.currentEndArrows = parsedEndArrows
                        }
                        if hasAutoField {
                            self.autoDetectEnabled = false
                            UserDefaults.standard.set(false, forKey: "autoDetectEnabled_v2")
                            self.syncShotDetectionMotionSensors()
                        }
                        self.sensitivityLevel = fsSens
                        UserDefaults.standard.set(fsSens, forKey: "sensitivityLevel")
                    }
                    self.distanceM = fsDistM
                    self.arrowsPerEnd = fsPerEnd
                    self.endsCount = fsEnds
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
                        let reqStart = (calObj["manualStartAt"] as? Int64) ?? Int64((calObj["manualStartAt"] as? Double) ?? 0)
                        let reqStop = (calObj["manualStopAt"] as? Int64) ?? Int64((calObj["manualStopAt"] as? Double) ?? 0)
                        if reqStart > 0 && reqStart != self.lastHandledStartAt && (nowMs - reqStart) <= 25_000 && reqStop < reqStart {
                            self.lastHandledStartAt = reqStart
                            self.startManualAnalysis(notifyPhone: false)
                        }
                        if reqStop > 0 && reqStop != self.lastHandledStopAt && (nowMs - reqStop) <= 15_000 {
                            self.lastHandledStopAt = reqStop
                            if self.manualAnalysisRecording {
                                self.stopManualAnalysis(notifyPhone: false)
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
            } else if http.statusCode == 404 {
                DispatchQueue.main.async { self.isCloudSynced = false }
            }
        }.resume()
    }

    func startManualAnalysis(notifyPhone: Bool = true) {
        guard analysisMode, !manualAnalysisRecording else { return }
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        manualAnalysisRecording = true
        manualAnalysisStartMs = nowMs
        manualAnalysisElapsedSec = 0.0
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

    func stopManualAnalysis(notifyPhone: Bool = true) {
        guard manualAnalysisRecording else { return }
        let endMs = Int64(Date().timeIntervalSince1970 * 1000)
        let startMs = manualAnalysisStartMs
        manualAnalysisRecording = false
        manualAnalysisStartMs = 0
        manualTimer?.invalidate()
        manualTimer = nil
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.stop)

        let windowSamples = motionBuf.filter { $0.t >= startMs && $0.t <= endMs - 40 }
        guard windowSamples.count >= 6 else {
            if notifyPhone {
                sendCommandToPhone(["type": "ANALYSIS_MANUAL_STOP", "ts": endMs, "source": "watch_manual"])
            }
            return
        }

        let refSlice = Array(windowSamples.suffix(min(15, windowSamples.count)))
        let refAx = refSlice.reduce(0.0) { $0 + $1.ax } / Double(refSlice.count)
        let refAy = refSlice.reduce(0.0) { $0 + $1.ay } / Double(refSlice.count)
        let refAz = refSlice.reduce(0.0) { $0 + $1.az } / Double(refSlice.count)
        let refNorm = max(0.4, sqrt(refAx * refAx + refAy * refAy + refAz * refAz))
        let wristSign = (bowWristStr == "RIGHT") ? -1.0 : 1.0
        let faceRadiusCm = (distanceM <= 20) ? 20.0 : ((distanceM <= 26) ? 30.0 : ((distanceM <= 36) ? 40.0 : 61.0))
        let distCm = max(1000.0, Double(distanceM) * 100.0)

        var sAy = windowSamples[0].ay
        var sAz = windowSamples[0].az
        var nxArr: [Double] = []
        var nyArr: [Double] = []
        for s in windowSamples {
            sAy = 0.80 * sAy + 0.20 * s.ay
            sAz = 0.80 * sAz + 0.20 * s.az
            let yaw = ((sAy - refAy) / refNorm) * wristSign * 0.28
            let pitch = ((sAz - refAz) / refNorm) * 0.28
            let dxCm = tan(yaw) * distCm
            let dyCm = tan(pitch) * distCm
            nxArr.append(max(-1.08, min(1.08, dxCm / faceRadiusCm)))
            nyArr.append(max(-1.08, min(1.08, dyCm / faceRadiusCm)))
        }

        let n = windowSamples.count
        let settleIdx = max(1, min(n - 2, (n * 35) / 100))
        let prepSec = max(0.4, min(10.0, Double(windowSamples[settleIdx].t - windowSamples[0].t) / 1000.0))
        let aimSec = max(0.5, min(24.0, Double(windowSamples[n - 1].t - windowSamples[settleIdx].t) / 1000.0))

        var sumSq = 0.0
        let aimCount = max(1, n - settleIdx)
        for i in settleIdx..<n {
            let cxCm = nxArr[i] * faceRadiusCm
            let cyCm = nyArr[i] * faceRadiusCm
            sumSq += cxCm * cxCm + cyCm * cyCm
        }
        let swayCm = max(0.3, min(faceRadiusCm, sqrt(sumSq / Double(aimCount))))
        let stabPct = max(38, min(99, Int(round(100.0 - (swayCm / faceRadiusCm) * 82.0))))
        let preIdx = max(0, n - 8)
        let relJumpCm = max(0.2, hypot(nxArr[n - 1] - nxArr[preIdx], nyArr[n - 1] - nyArr[preIdx]) * faceRadiusCm)

        let pCount = min(8, max(2, settleIdx + 1))
        var pPts: [[Double]] = []
        for j in 0..<pCount {
            let idx = min(n - 1, (j * settleIdx) / max(1, pCount - 1))
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
        var compact: [String: Any] = [
            "id": "SHOT-\(endMs)-\(arrowCount)",
            "n": arrowCount,
            "ts": endMs,
            "d": distanceM,
            "bowType": bowTypeStr,
            "prepSec": (prepSec * 10.0).rounded() / 10.0,
            "aimSec": (aimSec * 10.0).rounded() / 10.0,
            "stab": stabPct,
            "swayCm": (swayCm * 10.0).rounded() / 10.0,
            "relCm": (relJumpCm * 10.0).rounded() / 10.0,
            "p": pPts,
            "a": aPts,
            "r": aPts.last ?? [0.0, 0.0]
        ]
        if heartRateBpm >= 30 && heartRateBpm <= 245 {
            compact["bpm"] = heartRateBpm
        }
        if let jsonData = try? JSONSerialization.data(withJSONObject: compact),
           let jsonStr = String(data: jsonData, encoding: .utf8) {
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

    func incrementArrow(delta: Int, source: String = "watch_manual") {
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
        markUserActivity(isWriteAction: true)
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
        guard !currentEndArrows.isEmpty else {
            markUserActivity(isWriteAction: false)
            return
        }
        markUserActivity(isWriteAction: true)
        let removed = currentEndArrows.removeLast()
        let pts = (removed == "X" || removed == "10") ? 10 : (removed == "M" ? 0 : (Int(removed) ?? 0))
        totalScore = max(0, totalScore - pts)
        arrowCount = max(0, arrowCount - 1)
        WKInterfaceDevice.current().play(.click)
        sendCommandToPhone(["type": "UNDO_ARROW", "totalScore": totalScore])
    }

    func advanceToNextEnd() {
        guard !currentEndArrows.isEmpty else {
            markUserActivity(isWriteAction: false)
            return
        }
        markUserActivity(isWriteAction: true)
        currentEndArrows.removeAll()
        currentEnd = min(endsCount, currentEnd + 1)
        WKInterfaceDevice.current().play(.success)
        sendCommandToPhone(["type": "NEXT_END"])
    }

    func syncTelemetryManual() {
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.click)
        maybeSyncTelemetryToPhone(force: true)
        if hasPairingCode && pairingCode.count == 6 {
            pollFirestoreCloud()
        }
    }

    func finishSession() {
        markUserActivity(isWriteAction: true)
        WKInterfaceDevice.current().play(.success)
        maybeSyncTelemetryToPhone(force: true)
        sendCommandToPhone(["type": "FINISH_SESSION_FROM_WATCH"])
        resetSessionCounters(newSessionId: "")
        screenIndex = 0
    }

    func sendCommandToPhone(_ payload: [String: Any]) {
        if let evtType = payload["type"] as? String {
            let extra = (payload["analysisShotJson"] as? String) ?? (payload["value"] as? String) ?? (payload["source"] as? String)
            syncWithFirestoreCloud(eventType: evtType, extraValue: extra)
        }
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        cmdSequence += 1
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        var enriched = payload
        let idStr = "\(nowMs)-\(cmdSequence)"
        enriched["_cmdId"] = idStr
        enriched["cmdId"] = idStr
        enriched["_cmdSeq"] = cmdSequence
        enriched["_ts"] = nowMs

        if session.isReachable {
            session.sendMessage(enriched, replyHandler: { _ in
                DispatchQueue.main.async { self.isPhoneConnected = true }
            }, errorHandler: { _ in
                DispatchQueue.main.async { self.isPhoneConnected = session.isReachable }
            })
        }
        session.transferUserInfo(enriched)
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isPhoneConnected = (activationState == .activated && session.isReachable)
        }
        if session.isReachable {
            session.sendMessage(["type": "REQUEST_STATE"], replyHandler: { [weak self] reply in
                self?.handleIncomingPhoneContext(reply)
            }, errorHandler: nil)
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isPhoneConnected = session.isReachable
        }
        if session.isReachable {
            session.sendMessage(["type": "REQUEST_STATE"], replyHandler: { [weak self] reply in
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
        replyHandler([
            "type": "PONG",
            "stepsCount": stepsCount,
            "distanceWalkedM": walkedMetersInt,
            "_ts": Int64(Date().timeIntervalSince1970 * 1000)
        ])
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handleIncomingPhoneContext(userInfo)
    }

    private func handleIncomingPhoneContext(_ dict: [String: Any]) {
        if let msgType = dict["type"] as? String {
            if msgType == "PING" {
                DispatchQueue.main.async { self.isPhoneConnected = true }
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
                    if let cmdType = dict["cmdType"] as? String {
                        if cmdType == "SET_SENSITIVITY", let sens = dict["sensitivityLevel"] as? Int {
                            self.sensitivityLevel = max(0, min(2, sens))
                            UserDefaults.standard.set(self.sensitivityLevel, forKey: "sensitivityLevel")
                        } else if cmdType == "TOGGLE_AUTO_DETECT" {
                            if let enabled = dict["enabled"] as? Bool {
                                self.autoDetectEnabled = enabled
                                UserDefaults.standard.set(enabled, forKey: "autoDetectEnabled_v2")
                                self.syncShotDetectionMotionSensors()
                            }
                            if let sens = dict["sensitivityLevel"] as? Int {
                                self.sensitivityLevel = max(0, min(2, sens))
                                UserDefaults.standard.set(self.sensitivityLevel, forKey: "sensitivityLevel")
                            }
                        }
                    }
                    self.scheduleNextCloudPoll()
                }
                return
            }
        }

        guard let snapStr = dict["snapshot_json"] as? String,
              let data = snapStr.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let obj = (json["payload"] as? [String: Any]) ?? json
        DispatchQueue.main.async {
            self.isPhoneConnected = WCSession.default.isReachable
            let sessionActive = (obj["sessionActive"] as? Bool) ?? true
            let incomingSessionId = (obj["sessionId"] as? String) ?? ""
            let nextArrows = (obj["arrowsCount"] as? Int) ?? self.arrowCount
            let nextScore = (obj["totalScore"] as? Int) ?? self.totalScore
            let nextEndIdx = (obj["currentEndIndex"] as? Int) ?? (self.currentEnd - 1)
            let nextEndArrows = ((obj["currentEndArrows"] as? [String]) ?? self.currentEndArrows).joined(separator: ",")
            let nextDistM = (obj["distanceM"] as? Int) ?? self.distanceM
            let nextAuto = (obj["autoDetectEnabled"] as? Bool) ?? self.autoDetectEnabled
            let nextSens = (obj["sensitivityLevel"] as? Int) ?? self.sensitivityLevel
            let phoneSig = "\(sessionActive ? 1 : 0)|\(incomingSessionId)|\(nextArrows)|\(nextScore)|\(nextEndIdx)|\(nextEndArrows)|\(nextDistM)|\(nextAuto ? 1 : 0)|\(nextSens)"
            if self.lastPhoneContextSig.isEmpty {
                self.lastPhoneContextSig = phoneSig
            } else if self.lastPhoneContextSig != phoneSig {
                self.lastPhoneContextSig = phoneSig
                self.lastActivityMs = Int64(Date().timeIntervalSince1970 * 1000)
                self.scheduleNextCloudPoll()
            }

            if !sessionActive || (!incomingSessionId.isEmpty && !self.currentSessionId.isEmpty && incomingSessionId != self.currentSessionId) {
                self.resetSessionCounters(newSessionId: sessionActive ? incomingSessionId : "")
                if !sessionActive {
                    return
                }
            } else if !incomingSessionId.isEmpty && self.currentSessionId.isEmpty {
                self.currentSessionId = incomingSessionId
                UserDefaults.standard.set(incomingSessionId, forKey: "currentSessionId")
            }

            if let arrows = obj["arrowsCount"] as? Int { self.arrowCount = max(0, arrows) }
            if let score = obj["totalScore"] as? Int { self.totalScore = max(0, score) }
            if let distM = obj["distanceM"] as? Int { self.distanceM = distM }
            if let lbs = obj["bowPoundageLbs"] as? Double { self.bowPoundageLbs = max(12.0, lbs) }
            else if let lbsInt = obj["bowPoundageLbs"] as? Int { self.bowPoundageLbs = max(12.0, Double(lbsInt)) }
            if let perEnd = obj["arrowsPerEnd"] as? Int { self.arrowsPerEnd = max(1, perEnd) }
            if let ends = obj["endsCount"] as? Int { self.endsCount = max(1, ends) }
            if let curIdx = obj["currentEndIndex"] as? Int { self.currentEnd = curIdx + 1 }
            if let endArrows = obj["currentEndArrows"] as? [String] { self.currentEndArrows = endArrows }
            if obj["autoDetectEnabled"] != nil {
                self.autoDetectEnabled = false
                UserDefaults.standard.set(false, forKey: "autoDetectEnabled_v2")
                self.syncShotDetectionMotionSensors()
            }
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
                }
            }
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
            CloudCodeWatchScreen(vm: vm).tag(4)
        }
        .tabViewStyle(.page)
        .onAppear { vm.markUserActivity(isWriteAction: false) }
    }
}

struct WatchBrandHeaderView: View {
    let pillText: String
    var isYellowPill: Bool = false
    var isMutedPill: Bool = false

    var body: some View {
        let accentColor = isMutedPill
            ? Color.white.opacity(0.35)
            : (isYellowPill
                ? Color(red: 1, green: 229/255, blue: 0)
                : Color(red: 0/255, green: 168/255, blue: 243/255))
        let bgFill = isMutedPill
            ? Color(red: 10/255, green: 13/255, blue: 19/255)
            : (isYellowPill
                ? Color(red: 16/255, green: 16/255, blue: 6/255)
                : Color(red: 4/255, green: 11/255, blue: 18/255))

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
                            : vm.tr("TOCA INICIO O BOTÓN DE ACCIÓN", "TAP START OR ACTION BTN"))
                )
                .font(.system(size: 10.5, weight: .black, design: .rounded).monospacedDigit())
                .foregroundColor(vm.manualAnalysisRecording ? Color(red: 1, green: 229/255, blue: 0) : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
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
                            .frame(maxWidth: .infinity, minHeight: 37)
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
                            .frame(maxWidth: .infinity, minHeight: 37)
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
            .onPlayPauseCommand {
                vm.toggleManualAnalysisFromHardware()
            }
        } else {
        VStack(spacing: 5) {
            WatchBrandHeaderView(
                pillText: vm.currentStatusPillLabel,
                isYellowPill: false,
                isMutedPill: !syncedNow
            )

            VStack(spacing: 3) {
                Text(vm.tr("VOLUMEN · FLECHAS", "VOLUME · ARROWS"))
                    .font(.system(size: 7, weight: .bold, design: .rounded))
                    .foregroundColor(.gray)

                HStack(spacing: 4) {
                    ForEach(0..<4, id: \.self) { idx in
                        Text(digits[idx])
                            .font(.system(size: 20, weight: .black, design: .rounded).monospacedDigit())
                            .foregroundColor(idx == 3 ? Color(red: 1, green: 229/255, blue: 0) : .white)
                            .frame(maxWidth: .infinity, minHeight: 33)
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
                        .frame(maxWidth: .infinity, minHeight: 37)
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
                        .frame(maxWidth: .infinity, minHeight: 37)
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
                Text("\(vm.tr("TANDA", "END")) \(vm.currentEnd) · \(vm.distanceM) M")
                    .font(.system(size: 7, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundColor(.gray)
                    .lineLimit(1)
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
        GeometryReader { geo in
            let slotCount = min(6, max(1, vm.arrowsPerEnd))
            let keyH = max(27.0, floor((geo.size.height - 62.0) / 3.0))

            VStack(spacing: 3.5) {
                Image("brand_logo_full")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 9.5)

                // Unified Compact Telemetry + End Slots Row: [T1·29P / E1·29P] [X][10][9][·][·][·]
                HStack(spacing: 3.5) {
                    Text("\(vm.tr("T", "E"))\(vm.currentEnd)·\(vm.totalScore)P")
                        .font(.system(size: 8.5, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .frame(height: 16)
                        .background(Color(red: 5/255, green: 13/255, blue: 23/255))
                        .overlay(
                            Capsule().stroke(Color(red: 0, green: 168/255, blue: 243/255), lineWidth: 1.1)
                        )
                        .clipShape(Capsule())

                    HStack(spacing: 2.5) {
                        ForEach(0..<slotCount, id: \.self) { idx in
                            let val = idx < vm.currentEndArrows.count ? vm.currentEndArrows[idx] : "–"
                            let filled = idx < vm.currentEndArrows.count
                            Text(val)
                                .font(.system(size: 8.5, weight: .heavy, design: .rounded).monospacedDigit())
                                .foregroundColor(filled ? fgColor(for: val) : .gray)
                                .frame(maxWidth: .infinity, minHeight: 16)
                                .background(Color(red: 7/255, green: 9/255, blue: 14/255))
                                .cornerRadius(3.5)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 3.5)
                                        .stroke(filled ? borderColor(for: val) : Color.white.opacity(0.16), lineWidth: 1)
                                )
                        }
                    }
                }

                // XL 4x3 Score Grid (~2x Tactile Area across all smartwatch sizes: 40mm..49mm)
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 3.5),
                        GridItem(.flexible(), spacing: 3.5),
                        GridItem(.flexible(), spacing: 3.5),
                        GridItem(.flexible(), spacing: 3.5)
                    ],
                    spacing: 3.5
                ) {
                    ForEach(scoreKeys, id: \.self) { key in
                        Button(action: { vm.recordScore(key) }) {
                            Text(key)
                                .font(.system(size: 16.5, weight: .black, design: .rounded).monospacedDigit())
                                .foregroundColor(fgColor(for: key))
                                .frame(maxWidth: .infinity, minHeight: keyH)
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
                            .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity, minHeight: 22)
                            .background(Color(red: 11/255, green: 14/255, blue: 21/255))
                            .overlay(
                                Capsule().stroke(Color(red: 71/255, green: 85/255, blue: 105/255), lineWidth: 1.1)
                            )
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)

                    Button(action: { vm.advanceToNextEnd() }) {
                        Text(vm.tr("SIG. TANDA", "NEXT END"))
                            .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity, minHeight: 22)
                            .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                            .overlay(
                                Capsule().stroke(Color(red: 0, green: 168/255, blue: 243/255), lineWidth: 1.1)
                            )
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 4)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .center)
        }
    }
}

struct BiometricsWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        VStack(spacing: 6) {
            WatchBrandHeaderView(
                pillText: vm.tr("BIOMETRÍA · PASOS", "BIOMETRICS · STEPS"),
                isYellowPill: true
            )
            .onTapGesture { vm.syncTelemetryManual() }

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(vm.tr("DISTANCIA", "DISTANCE"))
                        .font(.system(size: 7.5, weight: .bold, design: .rounded))
                        .foregroundColor(.gray)
                    Spacer()
                    Text("\(vm.stepsCount) \(vm.tr("PASOS", "STEPS"))")
                        .font(.system(size: 7.5, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundColor(Color(red: 0, green: 168/255, blue: 243/255))
                }
                Text(vm.walkedDualString)
                    .font(.system(size: 13.5, weight: .black, design: .rounded).monospacedDigit())
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
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
        let syncedNow = vm.isPhoneConnected || vm.isCloudSynced
        VStack(spacing: 6) {
            WatchBrandHeaderView(
                pillText: syncedNow ? vm.tr("RESUMEN · CONECTADO", "SUMMARY · SYNCED") : vm.tr("RESUMEN · LOCAL", "SUMMARY · LOCAL"),
                isMutedPill: !syncedNow
            )

            HStack(spacing: 5) {
                VStack {
                    Text(vm.tr("FLECHAS", "ARROWS"))
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
                    Text(vm.tr("PUNTAJE", "SCORE"))
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

            Text("\(vm.walkedPrimaryString) · \(vm.activeKcal) kcal")
                .font(.system(size: 10, weight: .heavy, design: .rounded).monospacedDigit())
                .foregroundColor(.white)

            Button(action: { vm.finishSession() }) {
                Text(vm.tr("GUARDAR", "SAVE"))
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .frame(maxWidth: .infinity, minHeight: 24)
                    .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                    .overlay(
                        Capsule().stroke(Color(red: 0, green: 168/255, blue: 243/255), lineWidth: 1.1)
                    )
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
    }
}

struct CloudCodeWatchScreen: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        let headerText: String = {
            if vm.isEditingCode {
                return "\(vm.tr("EDITAR", "EDIT")) \(vm.editDigitPos + 1)/6"
            }
            if vm.isCloudSynced {
                return vm.tr("CÓDIGO NUBE · SYNC", "CLOUD CODE · SYNC")
            }
            return vm.hasPairingCode
                ? vm.tr("CÓDIGO NUBE", "CLOUD CODE")
                : vm.tr("TOCA PARA VINCULAR", "TAP TO LINK")
        }()

        VStack(spacing: 6) {
            WatchBrandHeaderView(
                pillText: headerText,
                isYellowPill: vm.isEditingCode,
                isMutedPill: !vm.isCloudSynced && !vm.isEditingCode
            )

            HStack(spacing: 3.5) {
                ForEach(0..<6, id: \.self) { idx in
                    let isSel = (idx == vm.editDigitPos)
                    Button(action: {
                        if vm.editDigitPos == idx {
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
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(isSel ? Color(red: 8/255, green: 21/255, blue: 35/255) : Color(red: 11/255, green: 14/255, blue: 21/255))
                            .cornerRadius(6)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(isSel ? Color(red: 0, green: 168/255, blue: 243/255) : Color(red: 1, green: 229/255, blue: 0), lineWidth: 1.1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 5) {
                Button(action: { vm.adjustSelectedCodeDigit(delta: -1) }) {
                    Text("−")
                        .font(.system(size: 12, weight: .black, design: .rounded))
                        .frame(width: 32, height: 22)
                        .background(Color(red: 24/255, green: 7/255, blue: 9/255))
                        .overlay(Capsule().stroke(Color(red: 1, green: 30/255, blue: 30/255), lineWidth: 1))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)

                Button(action: {
                    vm.isEditingCode = true
                    vm.editDigitPos = (vm.editDigitPos + 1) % 6
                    vm.markUserActivity(isWriteAction: true)
                    WKInterfaceDevice.current().play(.click)
                }) {
                    Text(vm.tr("EDITAR >", "EDIT >"))
                        .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                        .frame(maxWidth: .infinity, minHeight: 22)
                        .background(Color(red: 11/255, green: 14/255, blue: 21/255))
                        .overlay(Capsule().stroke(Color(red: 71/255, green: 85/255, blue: 105/255), lineWidth: 1))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)

                Button(action: { vm.adjustSelectedCodeDigit(delta: 1) }) {
                    Text("+")
                        .font(.system(size: 12, weight: .black, design: .rounded))
                        .frame(width: 32, height: 22)
                        .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                        .overlay(Capsule().stroke(Color(red: 0, green: 168/255, blue: 243/255), lineWidth: 1))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }

            Button(action: { vm.commitPairingDigits() }) {
                Text(vm.isEditingCode ? vm.tr("LISTO", "DONE") : (vm.isCloudSynced ? vm.tr("VINCULADO", "SYNCED") : vm.tr("CÓDIGO NUBE", "CLOUD CODE")))
                    .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                    .frame(maxWidth: .infinity, minHeight: 23)
                    .background(Color(red: 6/255, green: 21/255, blue: 35/255))
                    .overlay(
                        Capsule().stroke(
                            vm.isCloudSynced ? Color(red: 1, green: 229/255, blue: 0) : Color(red: 0, green: 168/255, blue: 243/255),
                            lineWidth: 1.1
                        )
                    )
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
    }
}
