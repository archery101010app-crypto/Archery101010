using Toybox.Application;
using Toybox.ActivityMonitor;
using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Sensor;
using Toybox.Position;
using Toybox.Attention;
using Toybox.Communications;
using Toybox.Math;
using Toybox.System;
using Toybox.Timer;
using Toybox.Time;
using Toybox.Lang;

/**
 * ARCHERY 101010 — Connect IQ Watch App (Matte OLED Edition v2.88)
 * 5 Screens synchronized in real time via 6-Digit Cloud Sync + Phone Bridge:
 *  - Screen 0: Contador 4 Dígitos (0 0 0 0) + Auto-Tiro (25Hz) + Mts & Kcal
 *  - Screen 1: Puntuación Completa (X, 10..1, M) + Slots de Tanda + BORRAR / SIG. TANDA
 *  - Screen 2: Métricas Biométricas (Podómetro · Pasos, mts · ft + kcal)
 *  - Screen 3: Resumen de Sesión + Envío a Coach
 *  - Screen 4: Vinculación en Nube por Código de 6 Dígitos
 */
class Archery101010WatchApp extends Application.AppBase {
    hidden var mView as Archery101010WatchView?;
    hidden var mPhoneMsgCallback = null;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        if (Sensor has :setEnabledSensors) {
            try {
                Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE] as Lang.Array<Sensor.SensorType>);
            } catch (ex) {}
        }
        // Connect IQ Companion Listener Hygiene (#12):
        // Direct Connect IQ BLE PhoneAppMessages are an optional local fast-path ONLY when paired
        // with a native Connect IQ companion SDK integration; 6-digit Cloud Sync over HTTPS
        // (watch_sessions/{code}) is the universal standalone channel across Android, iOS, and Web.
        // Keep registration safely wrapped in has-check + try/catch with a retained callback reference.
        if (Communications has :registerForPhoneAppMessages) {
            try {
                mPhoneMsgCallback = method(:onPhoneMessage);
                Communications.registerForPhoneAppMessages(mPhoneMsgCallback);
            } catch (ex) {}
        }
    }

    function onStop(state) {
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
        if (Sensor has :setEnabledSensors) {
            try {
                Sensor.setEnabledSensors([] as Lang.Array<Sensor.SensorType>);
            } catch (ex) {}
        }
        if (Sensor has :unregisterSensorDataListener) {
            try {
                Sensor.unregisterSensorDataListener();
            } catch (ex) {}
        }
        mPhoneMsgCallback = null;
        if (mView != null) {
            mView.saveStateToStorage();
        }
    }

    function onPosition(info as Position.Info) as Void {
        if (mView != null) {
            mView.updateGpsPosition(info);
        }
    }

    function onPhoneMessage(msg as Communications.PhoneAppMessage) as Void {
        if (mView != null && msg != null && msg.data != null) {
            mView.handleIncomingPhoneData(msg.data);
        }
    }

    function getInitialView() {
        var view = new Archery101010WatchView();
        mView = view;
        var delegate = new Archery101010WatchDelegate(view);
        return [ view, delegate ];
    }
}

class Archery101010WatchView extends WatchUi.View {
    public var screenIdx = 0; // 0: Counter, 1: Score Pad (12 keys), 2: Biometrics, 3: Summary, 4: 6-Digit Cloud Code
    public var arrowsCount = 0;
    public var totalScore = 0;
    public var currentEnd = 1;
    public var endsCount = 12;
    public var arrowsPerEnd = 6;
    public var distanceM = 18;
    public var bowPoundageLbs = 38;
    public var stepsCount = 0;
    public var gpsDistanceM = 0.0;
    public var distanceWalkedM = 0;
    public var activeKcal = 0;
    public var heartRateBpm = 0;
    public var avgHeartRateBpm = 0;
    public var maxHeartRateBpm = 0;
    public var autoDetectEnabled = false;
    public var sensitivityLevel = 1; // 0: BAJA, 1: MEDIA, 2: ALTA
    public var selectedScoreIdx = 0; // 0..11
    public var scoreLabels as Lang.Array<Lang.String> = ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"];
    public var currentEndArrows as Lang.Array<Lang.String> = [] as Lang.Array<Lang.String>;
    public var currentSessionId = "";

    // Locale & Regional Units state (ES vs EN universal fallback + Metric vs Imperial)
    public var isSpanish = false;
    public var isImperial = false;
    public var lastSavedFeedbackMs = 0;

    // 6-Digit Cloud Sync state
    public var pairingDigits as Lang.Array<Lang.Number> = [1, 0, 1, 0, 1, 0];
    public var hasPairingCode = false;
    public var pairingCode = "";
    public var isEditingCode = false;
    public var editDigitPos = 0;
    public var isCloudSynced = false;
    public var mCloudSyncOk = false;
    public var isBleConnected = false;

    private var mStartElapsedDistM = null;
    private var mLastLat = null;
    private var mLastLon = null;
    private var mLastShotMs = 0;
    private var mLastStepMs = 0;
    private var mPrevStepMs = 0;
    private var mStepBoutCount = 0;
    private var mBaselineSteps = null;
    private var mLastObservedSteps = null;
    private var mWalkingLockUntilMs = 0;
    private var mHighFreqAccelActive = false;
    private var mSmoothedMagMg = 1000.0;

    // 3D Biomechanical Ring Buffer (40 samples = 1.6s at 25Hz)
    private var mRingSize = 40;
    private var mRingAx as Lang.Array<Lang.Float> = new [40] as Lang.Array<Lang.Float>;
    private var mRingAy as Lang.Array<Lang.Float> = new [40] as Lang.Array<Lang.Float>;
    private var mRingAz as Lang.Array<Lang.Float> = new [40] as Lang.Array<Lang.Float>;
    private var mRingMag as Lang.Array<Lang.Float> = new [40] as Lang.Array<Lang.Float>;
    private var mRingDelta as Lang.Array<Lang.Float> = new [40] as Lang.Array<Lang.Float>;
    private var mRingIdx = 0;
    private var mRingCount = 0;

    // Post-release 220ms follow-through verification state
    private var mPendingShotActive = false;
    private var mPendingShotStartMs = 0;
    private var mPendingFollowN = 0;
    private var mPendingFollowSumDelta = 0.0;
    private var mPendingFollowSumAx = 0.0;

    // Sensitive gait cadence detector
    private var mPrevSigMg = 0.0;
    private var mPrevPrevSigMg = 0.0;
    private var mLastPeakMs = 0;
    private var mPeakT0 = 0;
    private var mPeakT1 = 0;
    private var mPeakT2 = 0;
    private var mCmdSeq = 0;
    private var mPendingRetryCmd = null;
    private var mPendingRetryDelta = 0;
    private var mLastLocalActionMs = 0;
    private var mLastActivityMs = 0;
    private var mLastCloudPollMs = 0;
    private var mLastRemoteStateSig = "";
    private var mLastBleStateSig = "";
    private var mLastTelemetryPushSteps = 0;
    private var mHrSum = 0;
    private var mHrSamples = 0;
    private var mLastHrSampleMs = 0;
    private var mLastHrPushMs = 0;
    private var mSensorTimer = null;

    // Official Good Times + Geometric 101010 BrandLogo & Bundled Outfit Athletic Fonts
    private var mBrandLogo = null;
    private var mFontMicro = null;
    private var mFontLabel = null;
    private var mFontValue = null;
    private var mFontHero = null;

    function initialize() {
        View.initialize();
        var initNow = System.getTimer();
        mLastActivityMs = initNow;
        mLastCloudPollMs = initNow;
        refreshDeviceLocaleAndUnits();
        loadBrandResources();
        loadStateFromStorage();
        initStepBaseline();
        syncHighFreqAccelerometer();

        mSensorTimer = new Timer.Timer();
        mSensorTimer.start(method(:onSensorTick), 100, true);

        if (hasPairingCode && pairingCode.length() == 6) {
            pollFirestoreCloud();
        }
    }

    function onShow() as Void {
        refreshDeviceLocaleAndUnits();
        markUserActivity(false);
    }

    function getAdaptiveCloudPollIntervalMs(now as Lang.Number) as Lang.Number {
        if (now < mLastActivityMs) {
            mLastActivityMs = now;
        }
        var idleMs = now - mLastActivityMs;
        // 3-Tier Adaptive Cloud Polling:
        // Active (< 90s): 8,000 ms | Warm Idle (90s..5m): 20,000 ms | Deep Idle (>= 5m): 45,000 ms
        if (idleMs < 90000) {
            return 8000;
        } else if (idleMs < 300000) {
            return 20000;
        }
        return 45000;
    }

    function markUserActivity(isWriteAction as Lang.Boolean) as Void {
        var now = System.getTimer();
        mLastActivityMs = now;
        if (!isWriteAction && hasPairingCode && pairingCode.length() == 6 && !isEditingCode) {
            var sinceLocalMs = (now >= mLastLocalActionMs) ? (now - mLastLocalActionMs) : 999999;
            if ((now < mLastCloudPollMs || (now - mLastCloudPollMs) >= 8000) && sinceLocalMs >= 1500) {
                mLastCloudPollMs = now;
                pollFirestoreCloud();
            }
        }
    }

    (:typecheck(false))
    function refreshDeviceLocaleAndUnits() as Void {
        try {
            var devSettings = System.getDeviceSettings();
            if (devSettings != null) {
                if (devSettings has :systemLanguage) {
                    isSpanish = (devSettings.systemLanguage == System.LANGUAGE_SPA);
                }
                if (devSettings has :distanceUnits) {
                    isImperial = (devSettings.distanceUnits == System.UNIT_STATUTE);
                }
            }
        } catch (ex) {}
    }

    function tr(esStr as Lang.String, enStr as Lang.String) as Lang.String {
        return isSpanish ? esStr : enStr;
    }

    function formatWalkedMetric(meters as Lang.Number) as Lang.String {
        var safeM = (meters >= 0) ? meters : 0;
        if (safeM >= 1000) {
            var hundKm = (safeM * 100 + 500) / 1000;
            var kmW = hundKm / 100;
            var kmF = hundKm % 100;
            return kmW.toString() + "." + ((kmF < 10) ? "0" : "") + kmF.toString() + " km";
        }
        return safeM.toString() + " m";
    }

    function formatWalkedImperial(meters as Lang.Number) as Lang.String {
        var safeM = (meters >= 0) ? meters : 0;
        var hundMi = ((safeM * 100.0) / 1609.344 + 0.5).toNumber();
        if (hundMi >= 10) {
            var miW = hundMi / 100;
            var miF = hundMi % 100;
            return miW.toString() + "." + ((miF < 10) ? "0" : "") + miF.toString() + " mi";
        }
        var ftVal = (safeM * 3.28084 + 0.5).toNumber();
        return ftVal.toString() + " ft";
    }

    function formatWalkedPrimary(meters as Lang.Number) as Lang.String {
        return isImperial ? formatWalkedImperial(meters) : formatWalkedMetric(meters);
    }

    function formatWalkedDual(meters as Lang.Number) as Lang.String {
        var mStr = formatWalkedMetric(meters);
        var iStr = formatWalkedImperial(meters);
        return isImperial ? (iStr + " · " + mStr) : (mStr + " · " + iStr);
    }

    (:typecheck(false))
    function loadBrandResources() as Void {
        try {
            mBrandLogo = WatchUi.loadResource(Rez.Drawables.BrandLogo);
        } catch (ex) {
            mBrandLogo = null;
        }
        try {
            mFontMicro = WatchUi.loadResource(Rez.Fonts.OutfitMicro);
            mFontLabel = WatchUi.loadResource(Rez.Fonts.OutfitLabel);
            mFontValue = WatchUi.loadResource(Rez.Fonts.OutfitValue);
            mFontHero = WatchUi.loadResource(Rez.Fonts.OutfitHero);
        } catch (ex) {
            mFontMicro = Graphics.FONT_XTINY;
            mFontLabel = Graphics.FONT_XTINY;
            mFontValue = Graphics.FONT_SMALL;
            mFontHero = Graphics.FONT_NUMBER_MEDIUM;
        }
    }

    function initStepBaseline() as Void {
        if (Toybox has :ActivityMonitor) {
            var monInfo = ActivityMonitor.getInfo();
            if (monInfo != null && (monInfo has :steps) && monInfo.steps != null) {
                var rawSteps = monInfo.steps;
                mLastObservedSteps = rawSteps;
                if (stepsCount > 0 && rawSteps >= stepsCount) {
                    mBaselineSteps = rawSteps - stepsCount;
                } else {
                    mBaselineSteps = rawSteps;
                }
            }
        }
    }

    (:typecheck(false))
    function registerHighFreqAccelerometer() as Void {
        if (mHighFreqAccelActive) {
            return;
        }
        if (Sensor has :registerSensorDataListener) {
            try {
                var opts = {
                    :period => 1,
                    :accelerometer => {
                        :enabled => true,
                        :sampleRate => 25
                    }
                };
                Sensor.registerSensorDataListener(method(:onAccelBatch), opts);
                mHighFreqAccelActive = true;
            } catch (ex) {
                mHighFreqAccelActive = false;
            }
        }
    }

    (:typecheck(false))
    function unregisterHighFreqAccelerometer() as Void {
        mPendingShotActive = false;
        if (mHighFreqAccelActive && (Sensor has :unregisterSensorDataListener)) {
            try {
                Sensor.unregisterSensorDataListener();
            } catch (ex) {}
        }
        mHighFreqAccelActive = false;
    }

    (:typecheck(false))
    function syncHighFreqAccelerometer() as Void {
        // Garmin Connect IQ has no microphone API for Dual-Key string-snap verification;
        // keep arrow counting 100% deterministic Manual Mode (zero false positives, max battery life).
        autoDetectEnabled = false;
        unregisterHighFreqAccelerometer();
    }

    (:typecheck(false))
    function loadStateFromStorage() as Void {
        if (!(Application has :Storage)) {
            return;
        }
        try {
            var savedCode = Application.Storage.getValue("pairingCode");
            if (savedCode != null && savedCode instanceof Lang.String && savedCode.length() == 6) {
                pairingCode = savedCode;
                hasPairingCode = true;
                parsePairingDigitsFromString(savedCode);
            }
            var sid = Application.Storage.getValue("currentSessionId");
            if (sid != null && sid instanceof Lang.String) {
                currentSessionId = sid;
            }
            var ac = Application.Storage.getValue("arrowsCount");
            if (ac != null && ac instanceof Lang.Number) { arrowsCount = ac; }
            var ts = Application.Storage.getValue("totalScore");
            if (ts != null && ts instanceof Lang.Number) { totalScore = ts; }
            var ce = Application.Storage.getValue("currentEnd");
            if (ce != null && ce instanceof Lang.Number && ce >= 1) { currentEnd = ce; }
            var sc = Application.Storage.getValue("stepsCount");
            if (sc != null && sc instanceof Lang.Number && sc >= 0) { stepsCount = sc; }
            var dw = Application.Storage.getValue("distanceWalkedM");
            if (dw != null && dw instanceof Lang.Number && dw >= 0) { distanceWalkedM = dw; }
            autoDetectEnabled = false;
            var sl = Application.Storage.getValue("sensitivityLevel");
            if (sl != null && sl instanceof Lang.Number) { sensitivityLevel = sl; }
            var ea = Application.Storage.getValue("currentEndArrows");
            if (ea != null && ea instanceof Lang.Array) {
                var cleanArr = [] as Lang.Array<Lang.String>;
                for (var i = 0; i < ea.size(); i++) {
                    if (ea[i] != null) {
                        cleanArr.add(ea[i].toString());
                    }
                }
                currentEndArrows = cleanArr;
            }
        } catch (ex) {}
    }

    function saveStateToStorage() as Void {
        if (!(Application has :Storage)) {
            return;
        }
        try {
            if (hasPairingCode && pairingCode.length() == 6) {
                Application.Storage.setValue("pairingCode", pairingCode);
            }
            Application.Storage.setValue("currentSessionId", currentSessionId);
            Application.Storage.setValue("arrowsCount", arrowsCount);
            Application.Storage.setValue("totalScore", totalScore);
            Application.Storage.setValue("currentEnd", currentEnd);
            Application.Storage.setValue("stepsCount", stepsCount);
            Application.Storage.setValue("distanceWalkedM", distanceWalkedM);
            Application.Storage.setValue("autoDetect_v2", autoDetectEnabled);
            Application.Storage.setValue("sensitivityLevel", sensitivityLevel);
            Application.Storage.setValue("currentEndArrows", currentEndArrows);
        } catch (ex) {}
    }

    function parsePairingDigitsFromString(codeStr as Lang.String) as Void {
        if (codeStr.length() != 6) {
            return;
        }
        var chars = codeStr.toCharArray();
        for (var i = 0; i < 6; i++) {
            var d = chars[i].toNumber() - 48;
            if (d < 0 || d > 9) { d = (i == 0) ? 1 : 0; }
            if (i == 0 && d == 0) { d = 1; }
            pairingDigits[i] = d;
        }
    }

    function commitPairingDigits() as Void {
        var built = "";
        for (var i = 0; i < 6; i++) {
            built = built + pairingDigits[i].toString();
        }
        pairingCode = built;
        hasPairingCode = true;
        isEditingCode = false;
        mPendingRetryCmd = null;
        mPendingRetryDelta = 0;
        mLastRemoteStateSig = "";
        var now = System.getTimer();
        mLastActivityMs = now;
        mLastCloudPollMs = now;
        saveStateToStorage();
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(70, 60)]);
        }
        pollFirestoreCloud();
        syncWithFirestoreCloud("SYNC_TELEMETRY_FROM_WATCH", null);
        WatchUi.requestUpdate();
    }

    function adjustSelectedCodeDigit(delta as Lang.Number) as Void {
        markUserActivity(true);
        var cur = pairingDigits[editDigitPos];
        if (editDigitPos == 0) {
            var nextFirst = cur + delta;
            if (nextFirst > 9) { nextFirst = 1; }
            if (nextFirst < 1) { nextFirst = 9; }
            pairingDigits[0] = nextFirst;
        } else {
            pairingDigits[editDigitPos] = (cur + delta + 10) % 10;
        }
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(35, 25)]);
        }
        WatchUi.requestUpdate();
    }

    function resetAllCounters(nextSessionId as Lang.String) as Void {
        currentSessionId = nextSessionId;
        arrowsCount = 0;
        totalScore = 0;
        currentEnd = 1;
        currentEndArrows = [] as Lang.Array<Lang.String>;
        stepsCount = 0;
        mLastTelemetryPushSteps = 0;
        gpsDistanceM = 0.0;
        distanceWalkedM = 0;
        activeKcal = 0;
        heartRateBpm = 0;
        avgHeartRateBpm = 0;
        maxHeartRateBpm = 0;
        mHrSum = 0;
        mHrSamples = 0;
        mStartElapsedDistM = null;
        mLastLat = null;
        mLastLon = null;
        if (Toybox has :ActivityMonitor) {
            var monInfo = ActivityMonitor.getInfo();
            if (monInfo != null && (monInfo has :steps) && monInfo.steps != null) {
                mBaselineSteps = monInfo.steps;
                mLastObservedSteps = monInfo.steps;
            }
        }
        saveStateToStorage();
        WatchUi.requestUpdate();
    }

    (:typecheck(false))
    function isTrueArcheryAnchorMg(
        reqSamples as Lang.Number,
        quietMeanMg as Lang.Float,
        quietPeakMg as Lang.Float,
        preRampMg as Lang.Float,
        axisSpanMg as Lang.Float
    ) as Lang.Boolean {
        // Leave last 1 sample (~40ms) right before shock rise; inspect preceding reqSamples (1.05s - 1.50s)
        if (mRingCount < (reqSamples + 1)) {
            return false;
        }
        var sumDelta = 0.0;
        var recentSum = 0.0;
        var recentN = 0;
        var sumAx = 0.0;
        var sumAy = 0.0;
        var sumAz = 0.0;
        var minAx = 99999.0; var maxAx = -99999.0;
        var minAy = 99999.0; var maxAy = -99999.0;
        var minAz = 99999.0; var maxAz = -99999.0;

        for (var k = 1; k <= reqSamples; k++) {
            var idx = (mRingIdx - 1 - k + mRingSize) % mRingSize;
            var d = mRingDelta[idx];
            if (d == null || d > quietPeakMg) {
                return false;
            }
            var sx = mRingAx[idx];
            var sy = mRingAy[idx];
            var sz = mRingAz[idx];
            sumDelta = sumDelta + d;
            if (k <= 5) {
                recentSum = recentSum + d;
                recentN = recentN + 1;
            }
            sumAx = sumAx + sx;
            sumAy = sumAy + sy;
            sumAz = sumAz + sz;
            if (sx < minAx) { minAx = sx; }
            if (sx > maxAx) { maxAx = sx; }
            if (sy < minAy) { minAy = sy; }
            if (sy > maxAy) { maxAy = sy; }
            if (sz < minAz) { minAz = sz; }
            if (sz > maxAz) { maxAz = sz; }
        }

        if ((sumDelta / reqSamples) > quietMeanMg) {
            return false;
        }
        if (recentN >= 3 && (recentSum / recentN) > preRampMg) {
            return false;
        }

        // 3D Forearm Horizontal Aiming Posture (rejects walking arms-down & quiver reach)
        var meanAx = sumAx / reqSamples;
        var meanAy = sumAy / reqSamples;
        var meanAz = sumAz / reqSamples;
        var gNorm = Math.sqrt(meanAx * meanAx + meanAy * meanAy + meanAz * meanAz).toFloat();
        if (gNorm < 835.0 || gNorm > 1165.0) {
            return false;
        }
        var forearmVert = (meanAx.abs().toFloat()) / gNorm;
        var perpG = Math.sqrt(meanAy * meanAy + meanAz * meanAz).toFloat();
        if (forearmVert > 0.68 || perpG < 690.0) {
            return false;
        }

        // 3D Wrist-Angle Stability (rejects twisting arrow puller or rotating wrist)
        if ((maxAx - minAx) > axisSpanMg || (maxAy - minAy) > axisSpanMg || (maxAz - minAz) > axisSpanMg) {
            return false;
        }
        return true;
    }

    (:typecheck(false))
    function hasSharpJerkMg(currentMagMg as Lang.Float, minJerkMg as Lang.Float) as Lang.Boolean {
        if (mRingCount < 3) {
            return false;
        }
        var maxJump = 0.0;
        for (var k = 1; k <= 2; k++) {
            var idx = (mRingIdx - k + mRingSize) % mRingSize;
            var prevMag = mRingMag[idx];
            if (prevMag != null) {
                var jump = (currentMagMg - prevMag).abs().toFloat();
                if (jump > maxJump) {
                    maxJump = jump;
                }
            }
        }
        return maxJump >= minJerkMg;
    }

    (:typecheck(false))
    function processAccelSampleMg(ax as Lang.Float, ay as Lang.Float, az as Lang.Float, now as Lang.Number) as Void {
        var magMg = Math.sqrt(ax * ax + ay * ay + az * az).toFloat();
        var dynamicMg = magMg - mSmoothedMagMg;
        mSmoothedMagMg = (0.95 * mSmoothedMagMg) + (0.05 * magMg);
        var deltaMg = (magMg - 1000.0).abs().toFloat();
        var absDynMg = dynamicMg.abs().toFloat();
        var sigMg = (deltaMg > absDynMg) ? deltaMg : absDynMg;

        // Sensitive walking / bow-carry cadence lock (>= 112 mg peaks)
        if (mPrevSigMg >= 112.0 && mPrevSigMg > mPrevPrevSigMg && mPrevSigMg >= sigMg && (now - mLastPeakMs) >= 290) {
            mLastPeakMs = now;
            mPeakT2 = mPeakT1;
            mPeakT1 = mPeakT0;
            mPeakT0 = now;
            if (mPeakT2 > 0 && (now - mPeakT2) <= 3000) {
                var g1 = mPeakT0 - mPeakT1;
                var g2 = mPeakT1 - mPeakT2;
                if (g1 >= 290 && g1 <= 1450 && g2 >= 290 && g2 <= 1450) {
                    var avg2 = (g1 + g2) / 2.0;
                    if ((g1 - avg2).abs() <= (avg2 * 0.34) && (g2 - avg2).abs() <= (avg2 * 0.34)) {
                        if ((now + 6500) > mWalkingLockUntilMs) {
                            mWalkingLockUntilMs = now + 6500;
                        }
                        mPendingShotActive = false;
                    }
                }
            }
        }
        mPrevPrevSigMg = mPrevSigMg;
        mPrevSigMg = sigMg;

        if (autoDetectEnabled) {
            var thresholdMg = (sensitivityLevel == 0) ? 2350.0 : ((sensitivityLevel == 2) ? 1550.0 : 1920.0);
            var minJerkMg = (sensitivityLevel == 0) ? 1380.0 : ((sensitivityLevel == 2) ? 940.0 : 1140.0);
            var quietMeanMg = (sensitivityLevel == 0) ? 54.0 : ((sensitivityLevel == 2) ? 82.0 : 66.0);
            var quietPeakMg = (sensitivityLevel == 0) ? 112.0 : ((sensitivityLevel == 2) ? 158.0 : 132.0);
            var preRampMg = (sensitivityLevel == 0) ? 52.0 : ((sensitivityLevel == 2) ? 78.0 : 64.0);
            var axisSpanMg = (sensitivityLevel == 0) ? 158.0 : ((sensitivityLevel == 2) ? 224.0 : 188.0);
            var reqSamples = (sensitivityLevel == 0) ? 36 : ((sensitivityLevel == 2) ? 25 : 31);
            var cooldownMs = (sensitivityLevel == 0) ? 7000 : ((sensitivityLevel == 2) ? 5000 : 6000);
            var isWalkingBlocked = (now < mWalkingLockUntilMs) || ((now - mLastStepMs) < 4800);

            if (mPendingShotActive) {
                if (isWalkingBlocked) {
                    mPendingShotActive = false;
                } else {
                    var elapsed = now - mPendingShotStartMs;
                    if (elapsed >= 80 && elapsed <= 250) {
                        mPendingFollowN = mPendingFollowN + 1;
                        mPendingFollowSumDelta = mPendingFollowSumDelta + deltaMg;
                        mPendingFollowSumAx = mPendingFollowSumAx + ax;
                    }
                    if (elapsed >= 220) {
                        mPendingShotActive = false;
                        var validFollow = (mPendingFollowN >= 2);
                        if (validFollow) {
                            var meanFollowDelta = mPendingFollowSumDelta / mPendingFollowN;
                            var meanFollowAx = (mPendingFollowSumAx / mPendingFollowN).abs();
                            if (meanFollowDelta > 795.0 || meanFollowAx > 815.0) {
                                validFollow = false;
                            }
                        }
                        if (validFollow && (now - mLastShotMs) > cooldownMs) {
                            mLastShotMs = now;
                            incrementArrow(1, true);
                        }
                    }
                }
            } else if (!isWalkingBlocked
                && deltaMg >= thresholdMg
                && (now - mLastShotMs) > cooldownMs
                && hasSharpJerkMg(magMg, minJerkMg)
                && isTrueArcheryAnchorMg(reqSamples, quietMeanMg, quietPeakMg, preRampMg, axisSpanMg)) {
                mPendingShotActive = true;
                mPendingShotStartMs = now;
                mPendingFollowN = 0;
                mPendingFollowSumDelta = 0.0;
                mPendingFollowSumAx = 0.0;
            }
        }

        mRingAx[mRingIdx] = ax;
        mRingAy[mRingIdx] = ay;
        mRingAz[mRingIdx] = az;
        mRingMag[mRingIdx] = magMg;
        mRingDelta[mRingIdx] = deltaMg;
        mRingIdx = (mRingIdx + 1) % mRingSize;
        if (mRingCount < mRingSize) {
            mRingCount = mRingCount + 1;
        }
    }

    (:typecheck(false))
    function onAccelBatch(sensorData as Sensor.SensorData) as Void {
        if (sensorData == null || !(sensorData has :accelerometerData) || sensorData.accelerometerData == null) {
            return;
        }
        var acc = sensorData.accelerometerData;
        var xs = acc.x;
        var ys = acc.y;
        var zs = acc.z;
        if (xs == null || ys == null || zs == null) {
            return;
        }
        var batchEndMs = System.getTimer();
        var n = xs.size();
        var dtMs = (n > 1) ? (1000 / n) : 40;
        for (var i = 0; i < n; i++) {
            var sampleMs = batchEndMs - ((n - 1 - i) * dtMs);
            processAccelSampleMg(xs[i].toFloat(), ys[i].toFloat(), zs[i].toFloat(), sampleMs);
        }
    }

    function cycleSensitivityMode() as Void {
        // Garmin uses 100% Manual Mode (Connect IQ does not expose real-time microphone audio for Dual-Key)
        autoDetectEnabled = false;
        syncHighFreqAccelerometer();
        markUserActivity(false);
        WatchUi.requestUpdate();
    }

    function onSensorTick() as Void {
        var now = System.getTimer();

        // Always update ActivityMonitor steps even when !autoDetectEnabled
        if (Toybox has :ActivityMonitor) {
            var monInfo = ActivityMonitor.getInfo();
            if (monInfo != null && (monInfo has :steps) && monInfo.steps != null) {
                var curMonSteps = monInfo.steps;
                if (mBaselineSteps == null || curMonSteps < mBaselineSteps) {
                    mBaselineSteps = curMonSteps;
                }
                if (mLastObservedSteps != null && curMonSteps > mLastObservedSteps) {
                    var stepInc = curMonSteps - mLastObservedSteps;
                    if ((now - mLastStepMs) > 9000) {
                        mStepBoutCount = 0;
                    }
                    mStepBoutCount = mStepBoutCount + stepInc;
                    mLastObservedSteps = curMonSteps;
                    mLastStepMs = now;
                    mPendingShotActive = false;
                    var lockMs = (mStepBoutCount >= 4) ? 9000 : 4800;
                    if ((now + lockMs) > mWalkingLockUntilMs) {
                        mWalkingLockUntilMs = now + lockMs;
                    }
                    var deltaSteps = curMonSteps - mBaselineSteps;
                    if (deltaSteps > stepsCount) {
                        stepsCount = deltaSteps;
                    }
                    recalculateMetrics();
                    if ((stepsCount - mLastTelemetryPushSteps) >= 3 && hasPairingCode) {
                        mLastTelemetryPushSteps = stepsCount;
                        syncWithFirestoreCloud("SYNC_TELEMETRY_FROM_WATCH", null);
                    }
                    WatchUi.requestUpdate();
                } else if (mLastObservedSteps == null) {
                    mLastObservedSteps = curMonSteps;
                }
            }
        }

        // Sample optical heart rate every ~2.0s (Sensor permission already active)
        if (now < mLastHrSampleMs || (now - mLastHrSampleMs) >= 2000) {
            mLastHrSampleMs = now;
            try {
                var hrInfo = Sensor.getInfo();
                if (hrInfo != null && (hrInfo has :heartRate) && hrInfo.heartRate != null) {
                    var curHr = hrInfo.heartRate.toNumber();
                    if (curHr >= 35 && curHr <= 240) {
                        heartRateBpm = curHr;
                        mHrSum = mHrSum + curHr;
                        mHrSamples = mHrSamples + 1;
                        avgHeartRateBpm = (mHrSum / mHrSamples).toNumber();
                        if (curHr > maxHeartRateBpm) {
                            maxHeartRateBpm = curHr;
                        }
                        if (hasPairingCode && pairingCode.length() == 6 && !isEditingCode) {
                            if (now < mLastHrPushMs || (now - mLastHrPushMs) >= 20000) {
                                mLastHrPushMs = now;
                                syncWithFirestoreCloud("SYNC_TELEMETRY_FROM_WATCH", null);
                            }
                        }
                    }
                }
            } catch (ex) {}
        }

        // 3-Tier Adaptive Cloud Polling (8s Active <90s | 20s Warm Idle 90s..5m | 45s Deep Idle >=5m)
        if (hasPairingCode && pairingCode.length() == 6 && !isEditingCode) {
            if (now < mLastCloudPollMs) {
                mLastCloudPollMs = now;
            }
            var pollIntervalMs = getAdaptiveCloudPollIntervalMs(now);
            var sinceLocalMs = (now >= mLastLocalActionMs) ? (now - mLastLocalActionMs) : 999999;
            if ((now - mLastCloudPollMs) >= pollIntervalMs && sinceLocalMs >= 1500) {
                mLastCloudPollMs = now;
                pollFirestoreCloud();
            }
        }

        // Fallback single-sample accel check ONLY when high-freq listener is unavailable AND autoDetectEnabled
        if (autoDetectEnabled && !mHighFreqAccelActive) {
            var info = Sensor.getInfo();
            if (info != null && (info has :accel) && info.accel != null) {
                var accelArr = info.accel;
                if (accelArr != null && accelArr.size() >= 3) {
                    processAccelSampleMg(
                        accelArr[0].toFloat(),
                        accelArr[1].toFloat(),
                        accelArr[2].toFloat(),
                        now
                    );
                }
            }
        }
    }

    (:typecheck(false))
    function handleIncomingPhoneData(data) as Void {
        if (data instanceof Lang.Dictionary) {
            isBleConnected = true;
            var bleAct = !(data.hasKey("sessionActive") && data["sessionActive"] == false);
            var bleSid = (data.hasKey("sessionId") && data["sessionId"] != null) ? data["sessionId"].toString() : currentSessionId;
            var bleArr = data.hasKey("arrowsCount") ? data["arrowsCount"].toNumber() : arrowsCount;
            var bleScore = data.hasKey("totalScore") ? data["totalScore"].toNumber() : totalScore;
            var bleEnd = data.hasKey("currentEndIndex") ? (data["currentEndIndex"].toNumber() + 1) : currentEnd;
            var bleAuto = (data.hasKey("autoDetectEnabled") && data["autoDetectEnabled"] != null)
                ? (data["autoDetectEnabled"] == true)
                : autoDetectEnabled;
            var nextBleSig = (bleAct ? "1|" : "0|") + bleSid + "|" + bleArr.toString() + "|" + bleScore.toString() + "|" + bleEnd.toString() + "|" + (bleAuto ? "1" : "0");
            if (mLastBleStateSig.length() == 0) {
                mLastBleStateSig = nextBleSig;
            } else if (!nextBleSig.equals(mLastBleStateSig)) {
                mLastBleStateSig = nextBleSig;
                mLastActivityMs = System.getTimer();
            }

            if (!bleAct) {
                resetAllCounters("");
                return;
            }
            if (bleSid.length() > 0 && currentSessionId.length() > 0 && !bleSid.equals(currentSessionId)) {
                resetAllCounters(bleSid);
            } else if (bleSid.length() > 0) {
                currentSessionId = bleSid;
            }
            if (data.hasKey("arrowsCount")) {
                arrowsCount = bleArr;
            }
            if (data.hasKey("totalScore")) {
                totalScore = bleScore;
            }
            if (data.hasKey("distanceM")) {
                distanceM = data["distanceM"].toNumber();
            }
            if (data.hasKey("arrowsPerEnd")) {
                arrowsPerEnd = data["arrowsPerEnd"].toNumber();
            }
            if (data.hasKey("endsCount")) {
                endsCount = data["endsCount"].toNumber();
            }
            if (data.hasKey("currentEndIndex")) {
                currentEnd = bleEnd;
            }
            if (data.hasKey("distanceWalkedM")) {
                var incomingM = data["distanceWalkedM"].toNumber();
                if (incomingM > distanceWalkedM) {
                    distanceWalkedM = incomingM;
                }
            }
            if (data.hasKey("activeKcal")) {
                activeKcal = data["activeKcal"].toNumber();
            }
            if (data.hasKey("autoDetectEnabled") && data["autoDetectEnabled"] != null) {
                autoDetectEnabled = false;
                syncHighFreqAccelerometer();
            }
            saveStateToStorage();
            WatchUi.requestUpdate();
        }
    }

    function updateGpsPosition(info as Position.Info?) as Void {
        if (info == null) {
            return;
        }
        // Use native elapsedDistance ONLY when an active positive distance delta exists
        if ((info has :elapsedDistance) && info.elapsedDistance != null) {
            var curElapsed = info.elapsedDistance.toFloat();
            if (curElapsed > 0.0) {
                if (mStartElapsedDistM == null || curElapsed < mStartElapsedDistM) {
                    mStartElapsedDistM = curElapsed;
                }
                var deltaM = curElapsed - mStartElapsedDistM;
                if (deltaM > gpsDistanceM) {
                    gpsDistanceM = deltaM;
                    recalculateMetrics();
                    WatchUi.requestUpdate();
                }
                return;
            }
        }

        // Haversine GNSS tracking across outdoor & covered ranges (QUALITY_POOR or better when moving >= 0.50 m/s)
        var hasValidFix = (info.accuracy != null && info.accuracy >= Position.QUALITY_POOR && info.position != null);
        if (hasValidFix) {
            var spdOk = true;
            if ((info has :speed) && info.speed != null) {
                var spd = info.speed.toFloat();
                if (spd < 0.48 || spd > 5.8) {
                    spdOk = false;
                }
            } else if (info.accuracy < Position.QUALITY_USABLE) {
                spdOk = false;
            }
            var radians = info.position.toRadians();
            var lat = radians[0];
            var lon = radians[1];
            if (mLastLat != null && mLastLon != null) {
                var R = 6371000.0;
                var dLat = lat - mLastLat;
                var dLon = lon - mLastLon;
                var a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0) +
                        Math.cos(mLastLat) * Math.cos(lat) * Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);
                var c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
                var stepM = R * c;
                if (stepM >= 4.2 && stepM <= 140.0) {
                    if (spdOk) {
                        gpsDistanceM = gpsDistanceM + stepM;
                        recalculateMetrics();
                        WatchUi.requestUpdate();
                    }
                    mLastLat = lat;
                    mLastLon = lon;
                }
            } else {
                mLastLat = lat;
                mLastLon = lon;
            }
        }
    }

    function scorePointsForLabel(val as Lang.String) as Lang.Number {
        if (val.equals("X") || val.equals("10")) {
            return 10;
        }
        if (val.equals("M")) {
            return 0;
        }
        var parsed = val.toNumber();
        return (parsed != null) ? parsed : 0;
    }

    function incrementArrow(delta as Lang.Number, isAuto as Lang.Boolean) as Void {
        mLastLocalActionMs = System.getTimer();
        markUserActivity(true);
        arrowsCount = arrowsCount + delta;
        if (arrowsCount < 0) { arrowsCount = 0; }
        if (Attention has :vibrate) {
            var vibe = [new Attention.VibeProfile(isAuto ? 85 : 55, isAuto ? 110 : 50)];
            Attention.vibrate(vibe);
        }
        recalculateMetrics();
        saveStateToStorage();
        var evt = (delta >= 0) ? "INCREMENT_ARROW" : "DECREMENT_ARROW";
        syncWithPhoneApp(evt, isAuto ? "watch_auto" : "watch_manual");
        WatchUi.requestUpdate();
    }

    function recordScoreInput(val as Lang.String) as Void {
        mLastLocalActionMs = System.getTimer();
        markUserActivity(true);
        var pts = scorePointsForLabel(val);
        if (currentEndArrows.size() >= arrowsPerEnd) {
            currentEndArrows = [] as Lang.Array<Lang.String>;
            if (currentEnd < endsCount) {
                currentEnd = currentEnd + 1;
            }
        }
        currentEndArrows.add(val);
        totalScore = totalScore + pts;
        arrowsCount = arrowsCount + 1;
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(65, 60)]);
        }
        recalculateMetrics();
        saveStateToStorage();
        syncWithPhoneApp("SCORE_INPUT", val);
        WatchUi.requestUpdate();
    }

    function undoLastScore() as Void {
        if (currentEndArrows.size() <= 0) {
            markUserActivity(false);
            return;
        }
        mLastLocalActionMs = System.getTimer();
        markUserActivity(true);
        var lastIdx = currentEndArrows.size() - 1;
        var removed = currentEndArrows[lastIdx];
        currentEndArrows = currentEndArrows.slice(0, lastIdx) as Lang.Array<Lang.String>;
        var pts = scorePointsForLabel(removed);
        totalScore = (totalScore >= pts) ? (totalScore - pts) : 0;
        if (arrowsCount > 0) {
            arrowsCount = arrowsCount - 1;
        }
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(50, 40)]);
        }
        recalculateMetrics();
        saveStateToStorage();
        syncWithPhoneApp("UNDO_ARROW", null);
        WatchUi.requestUpdate();
    }

    function advanceNextEnd() as Void {
        if (currentEndArrows.size() <= 0) {
            markUserActivity(false);
            return;
        }
        mLastLocalActionMs = System.getTimer();
        markUserActivity(true);
        currentEndArrows = [] as Lang.Array<Lang.String>;
        if (currentEnd < endsCount) {
            currentEnd = currentEnd + 1;
        }
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(70, 60)]);
        }
        saveStateToStorage();
        syncWithPhoneApp("NEXT_END", null);
        WatchUi.requestUpdate();
    }

    function finishSessionAndReset() as Void {
        mLastLocalActionMs = System.getTimer();
        markUserActivity(true);
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(85, 110)]);
        }
        lastSavedFeedbackMs = System.getTimer() + 2800;
        syncWithPhoneApp("FINISH_SESSION_FROM_WATCH", null);
        resetAllCounters("");
        WatchUi.requestUpdate();
    }

    function resetSessionFromWatch() as Void {
        markUserActivity(false);
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(55, 50)]);
        }
        lastSavedFeedbackMs = 0;
        resetAllCounters("");
        screenIdx = 0;
        WatchUi.requestUpdate();
    }

    function recalculateMetrics() as Void {
        var distM = gpsDistanceM;
        if (stepsCount > 0) {
            var stepMeters = stepsCount * 0.78;
            if (stepMeters > distM) {
                distM = stepMeters;
            }
        }
        if (distM.toNumber() > distanceWalkedM) {
            distanceWalkedM = distM.toNumber();
        }

        var kcalPerArrow = 0.56 + (bowPoundageLbs * 0.0165);
        var bowKcal = arrowsCount * kcalPerArrow;
        var walkKcal = (distanceWalkedM / 1000.0) * 72.0 * 0.78;
        activeKcal = (bowKcal + walkKcal).toNumber();
    }

    (:typecheck(false))
    function syncWithPhoneApp(eventType as Lang.String, extra) as Void {
        // 1. Universal standalone 6-Digit Cloud Sync via Firestore REST over HTTPS
        syncWithFirestoreCloud(eventType, extra);

        // 2. Optional local Connect IQ BLE fast-path ONLY when paired with a native Connect IQ
        // companion SDK integration (#12); wrapped in has-check + try/catch so standalone operation never faults.
        if (Communications has :transmit) {
            try {
                var payload = {
                    "type" => eventType,
                    "arrowsCount" => arrowsCount,
                    "totalScore" => totalScore,
                    "stepsCount" => stepsCount,
                    "distanceWalkedM" => distanceWalkedM,
                    "activeKcal" => activeKcal,
                    "autoDetectEnabled" => autoDetectEnabled,
                    "sensitivityLevel" => sensitivityLevel
                };
                if (extra != null && eventType.equals("SCORE_INPUT")) {
                    payload["value"] = extra;
                }
                Communications.transmit(payload, null, new CommListener(self));
            } catch (ex) {}
        }
    }

    (:typecheck(false))
    function sendCloudPatch(docFields as Lang.Dictionary) as Void {
        if (!hasPairingCode || pairingCode.length() != 6 || docFields == null) {
            return;
        }
        var hbEpochMsStr = (Time.now().value().toLong() * 1000l).toString();
        var updEpochMsStr = (Time.now().value().toLong() * 1000l + (System.getTimer() % 1000)).toString();
        docFields["watchHeartbeatAt"] = { "integerValue" => hbEpochMsStr };
        docFields["updatedAt"] = { "integerValue" => updEpochMsStr };

        var url =
            "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/" +
            pairingCode +
            "?updateMask.fieldPaths=lastWatchCmd&updateMask.fieldPaths=lastWatchCmdId&updateMask.fieldPaths=lastWatchCmdSeq&updateMask.fieldPaths=watchStepsCount&updateMask.fieldPaths=watchDistanceM&updateMask.fieldPaths=watchHeartRateBpm&updateMask.fieldPaths=watchAvgHeartRateBpm&updateMask.fieldPaths=watchMaxHeartRateBpm&updateMask.fieldPaths=watchSource&updateMask.fieldPaths=watchHeartbeatAt&updateMask.fieldPaths=updatedAt&currentDocument.exists=true";

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "X-HTTP-Method-Override" => "PATCH"
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        try {
            Communications.makeWebRequest(url, { "fields" => docFields }, options, method(:onCloudPatchResponse));
        } catch (ex) {}
    }

    (:typecheck(false))
    function syncWithFirestoreCloud(eventType as Lang.String, extra) as Void {
        if (!hasPairingCode || pairingCode.length() != 6) {
            return;
        }
        mCmdSeq = mCmdSeq + 1;
        var hbEpochMsStr = (Time.now().value().toLong() * 1000l).toString();
        var epochMsStr = (Time.now().value().toLong() * 1000l + (System.getTimer() % 1000)).toString();
        var cmdId = "gciq-" + epochMsStr + "-" + mCmdSeq.toString();

        var cmdFields = {
            "type" => { "stringValue" => eventType },
            "cmdId" => { "stringValue" => cmdId },
            "_cmdId" => { "stringValue" => cmdId },
            "_ts" => { "integerValue" => epochMsStr }
        };

        if (eventType.equals("INCREMENT_ARROW")) {
            var src = (extra != null) ? extra.toString() : "watch_manual";
            mPendingRetryDelta = mPendingRetryDelta + 1;
            if (mPendingRetryDelta > 20) { mPendingRetryDelta = 20; }
            if (mPendingRetryDelta == 0) { mPendingRetryDelta = 1; }
            var effIncType = (mPendingRetryDelta >= 0) ? "INCREMENT_ARROW" : "DECREMENT_ARROW";
            cmdFields["type"] = { "stringValue" => effIncType };
            cmdFields["delta"] = { "integerValue" => mPendingRetryDelta.toString() };
            cmdFields["source"] = { "stringValue" => src };
        } else if (eventType.equals("DECREMENT_ARROW")) {
            mPendingRetryDelta = mPendingRetryDelta - 1;
            if (mPendingRetryDelta < -20) { mPendingRetryDelta = -20; }
            if (mPendingRetryDelta == 0) { mPendingRetryDelta = -1; }
            var effDecType = (mPendingRetryDelta >= 0) ? "INCREMENT_ARROW" : "DECREMENT_ARROW";
            cmdFields["type"] = { "stringValue" => effDecType };
            cmdFields["delta"] = { "integerValue" => mPendingRetryDelta.toString() };
            cmdFields["source"] = { "stringValue" => "watch_manual" };
            cmdFields["totalScore"] = { "integerValue" => totalScore.toString() };
        } else if (eventType.equals("SCORE_INPUT") && extra != null) {
            mPendingRetryDelta = 0;
            cmdFields["value"] = { "stringValue" => extra.toString() };
            cmdFields["totalScore"] = { "integerValue" => totalScore.toString() };
        } else if (eventType.equals("UNDO_ARROW")) {
            mPendingRetryDelta = 0;
            cmdFields["totalScore"] = { "integerValue" => totalScore.toString() };
        } else if (eventType.equals("TOGGLE_AUTO_DETECT")) {
            cmdFields["enabled"] = { "booleanValue" => autoDetectEnabled };
            cmdFields["sensitivityLevel"] = { "integerValue" => sensitivityLevel.toString() };
        } else if (eventType.equals("SYNC_TELEMETRY_FROM_WATCH")) {
            cmdFields["stepsCount"] = { "integerValue" => stepsCount.toString() };
            cmdFields["distanceWalkedM"] = { "integerValue" => distanceWalkedM.toString() };
            cmdFields["activeKcal"] = { "integerValue" => activeKcal.toString() };
            if (avgHeartRateBpm >= 35) {
                cmdFields["heartRateBpm"] = { "integerValue" => heartRateBpm.toString() };
                cmdFields["avgHeartRateBpm"] = { "integerValue" => avgHeartRateBpm.toString() };
                cmdFields["maxHeartRateBpm"] = { "integerValue" => maxHeartRateBpm.toString() };
            }
        }

        // If a non-telemetry command is already waiting to retry, do not let a routine telemetry ping overwrite it
        if (eventType.equals("SYNC_TELEMETRY_FROM_WATCH") && mPendingRetryCmd != null) {
            sendCloudPatch(mPendingRetryCmd);
            return;
        }

        var docFields = {
            "lastWatchCmd" => { "mapValue" => { "fields" => cmdFields } },
            "lastWatchCmdId" => { "stringValue" => cmdId },
            "lastWatchCmdSeq" => { "integerValue" => mCmdSeq.toString() },
            "watchStepsCount" => { "integerValue" => stepsCount.toString() },
            "watchDistanceM" => { "integerValue" => distanceWalkedM.toString() },
            "watchHeartRateBpm" => { "integerValue" => heartRateBpm.toString() },
            "watchAvgHeartRateBpm" => { "integerValue" => avgHeartRateBpm.toString() },
            "watchMaxHeartRateBpm" => { "integerValue" => maxHeartRateBpm.toString() },
            "watchSource" => { "stringValue" => "GARMIN_CIQ" },
            "watchHeartbeatAt" => { "integerValue" => hbEpochMsStr },
            "updatedAt" => { "integerValue" => epochMsStr }
        };

        if (!eventType.equals("SYNC_TELEMETRY_FROM_WATCH")) {
            mPendingRetryCmd = docFields;
        }

        sendCloudPatch(docFields);
    }

    (:typecheck(false))
    function onCloudPatchResponse(responseCode, data) as Void {
        if (responseCode == 200) {
            mPendingRetryCmd = null;
            mPendingRetryDelta = 0;
            mCloudSyncOk = true;
            if (!isCloudSynced) {
                isCloudSynced = true;
                WatchUi.requestUpdate();
            }
        } else {
            if (responseCode == 404) {
                mPendingRetryCmd = null;
                mPendingRetryDelta = 0;
            }
            if (responseCode == 401 || responseCode == 403 || responseCode == 404 || (isCloudSynced && responseCode != -101)) {
                mCloudSyncOk = false;
                isCloudSynced = false;
                WatchUi.requestUpdate();
            }
        }
    }

    (:typecheck(false))
    function pollFirestoreCloud() as Void {
        if (!hasPairingCode || pairingCode.length() != 6) {
            return;
        }
        // Retry any unacknowledged local arrow/score command FIRST before polling remote state
        if (mPendingRetryCmd != null) {
            sendCloudPatch(mPendingRetryCmd);
            return;
        }
        var url =
            "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/" +
            pairingCode;
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        try {
            Communications.makeWebRequest(url, null, options, method(:onCloudPollResponse));
        } catch (ex) {}
    }

    (:typecheck(false))
    function extractFsInt(fields, key as Lang.String, fallback as Lang.Number) as Lang.Number {
        if (!fields.hasKey(key) || fields[key] == null) {
            return fallback;
        }
        var node = fields[key];
        if (!(node instanceof Lang.Dictionary)) {
            return fallback;
        }
        if (node.hasKey("integerValue") && node["integerValue"] != null) {
            var n = node["integerValue"].toNumber();
            return (n != null) ? n : fallback;
        }
        if (node.hasKey("doubleValue") && node["doubleValue"] != null) {
            return node["doubleValue"].toNumber();
        }
        return fallback;
    }

    (:typecheck(false))
    function extractFsString(fields, key as Lang.String, fallback as Lang.String) as Lang.String {
        if (!fields.hasKey(key) || fields[key] == null) {
            return fallback;
        }
        var node = fields[key];
        if ((node instanceof Lang.Dictionary) && node.hasKey("stringValue") && node["stringValue"] != null) {
            return node["stringValue"].toString();
        }
        return fallback;
    }

    (:typecheck(false))
    function extractFsBool(fields, key as Lang.String, fallback as Lang.Boolean) as Lang.Boolean {
        if (!fields.hasKey(key) || fields[key] == null) {
            return fallback;
        }
        var node = fields[key];
        if ((node instanceof Lang.Dictionary) && node.hasKey("booleanValue") && node["booleanValue"] != null) {
            return (node["booleanValue"] == true);
        }
        return fallback;
    }

    (:typecheck(false))
    function onCloudPollResponse(responseCode, data) as Void {
        if (responseCode == 401 || responseCode == 403) {
            mCloudSyncOk = false;
            isCloudSynced = false;
            WatchUi.requestUpdate();
            return;
        }
        if (responseCode == 200 && data != null && (data instanceof Lang.Dictionary) && data.hasKey("fields")) {
            mCloudSyncOk = true;
            isCloudSynced = true;
            var fields = data["fields"];
            if (!(fields instanceof Lang.Dictionary)) {
                return;
            }

            var sessionActive = extractFsBool(fields, "sessionActive", true);
            var incomingSid = extractFsString(fields, "sessionId", "");
            var fsArrows = extractFsInt(fields, "arrowsCount", arrowsCount);
            var fsScore = extractFsInt(fields, "totalScore", totalScore);
            var fsEnd = extractFsInt(fields, "currentEnd", currentEnd);
            var fsDistM = extractFsInt(fields, "distanceM", distanceM);
            var fsPerEnd = extractFsInt(fields, "arrowsPerEnd", arrowsPerEnd);
            var fsTotalEnds = extractFsInt(fields, "totalEnds", endsCount);
            var fsAuto = extractFsBool(fields, "autoDetectEnabled", autoDetectEnabled);
            var fsSens = extractFsInt(fields, "sensitivityLevel", sensitivityLevel);

            var hasEndArrowsField = false;
            var parsedEndArrows = [] as Lang.Array<Lang.String>;
            var endArrowsJoined = "";
            if (fields.hasKey("currentEndArrows") && fields["currentEndArrows"] instanceof Lang.Dictionary) {
                var arrNode = fields["currentEndArrows"];
                if (arrNode.hasKey("arrayValue") && arrNode["arrayValue"] instanceof Lang.Dictionary) {
                    hasEndArrowsField = true;
                    var av = arrNode["arrayValue"];
                    if (av.hasKey("values") && av["values"] instanceof Lang.Array) {
                        var vals = av["values"];
                        for (var i = 0; i < vals.size(); i++) {
                            var item = vals[i];
                            if ((item instanceof Lang.Dictionary) && item.hasKey("stringValue") && item["stringValue"] != null) {
                                var sv = item["stringValue"].toString();
                                parsedEndArrows.add(sv);
                                endArrowsJoined = endArrowsJoined + ((i > 0) ? "," : "") + sv;
                            }
                        }
                    }
                }
            }

            // Detect genuine remote state changes to immediately resume Active Tier polling
            var remoteSig = (sessionActive ? "1|" : "0|") + incomingSid + "|" +
                fsArrows.toString() + "|" + fsScore.toString() + "|" + fsEnd.toString() + "|" +
                endArrowsJoined + "|" + fsDistM.toString() + "|" + fsPerEnd.toString() + "|" +
                fsTotalEnds.toString() + "|" + (fsAuto ? "1|" : "0|") + fsSens.toString();
            if (mLastRemoteStateSig.length() == 0) {
                mLastRemoteStateSig = remoteSig;
            } else if (!remoteSig.equals(mLastRemoteStateSig)) {
                mLastRemoteStateSig = remoteSig;
                mLastActivityMs = System.getTimer();
            }

            var nowTimer = System.getTimer();
            var elapsedSinceLocal = (nowTimer >= mLastLocalActionMs) ? (nowTimer - mLastLocalActionMs) : 999999;

            if (!sessionActive) {
                if (mPendingRetryCmd == null && (mLastLocalActionMs == 0 || elapsedSinceLocal > 6000)) {
                    if (arrowsCount > 0 || totalScore > 0 || stepsCount > 0 || distanceWalkedM > 0) {
                        resetAllCounters("");
                    }
                }
                WatchUi.requestUpdate();
                return;
            }

            if (mPendingRetryCmd != null) {
                sendCloudPatch(mPendingRetryCmd);
                return;
            }

            if (incomingSid.length() > 0 && currentSessionId.length() > 0 && !incomingSid.equals(currentSessionId)) {
                resetAllCounters(incomingSid);
            } else if (incomingSid.length() > 0) {
                currentSessionId = incomingSid;
            }

            var recentlyTapped = (nowTimer >= mLastLocalActionMs) && (elapsedSinceLocal < 3500);
            if (!recentlyTapped) {
                arrowsCount = fsArrows;
                totalScore = fsScore;
                currentEnd = fsEnd;
                if (hasEndArrowsField) {
                    currentEndArrows = parsedEndArrows;
                }
            }

            distanceM = fsDistM;
            arrowsPerEnd = fsPerEnd;
            endsCount = fsTotalEnds;
            bowPoundageLbs = extractFsInt(fields, "bowPoundageLbs", bowPoundageLbs);
            autoDetectEnabled = false;
            sensitivityLevel = fsSens;
            syncHighFreqAccelerometer();

            var cloudWalked = extractFsInt(fields, "distanceWalkedM", 0);
            if (cloudWalked > distanceWalkedM) {
                distanceWalkedM = cloudWalked;
            }
            var cloudKcal = extractFsInt(fields, "caloriesBurnedKcal", 0);
            if (cloudKcal > activeKcal) {
                activeKcal = cloudKcal;
            }

            saveStateToStorage();
            WatchUi.requestUpdate();
        } else if (responseCode == 404 || responseCode < 0) {
            if (isCloudSynced || mCloudSyncOk) {
                mCloudSyncOk = false;
                isCloudSynced = false;
                WatchUi.requestUpdate();
            }
        }
    }

    (:typecheck(false))
    function pickFittingFont(dc as Graphics.Dc, txt as Lang.String, maxW as Lang.Number, f1, f2, f3) {
        if (f1 != null && dc.getTextWidthInPixels(txt, f1) <= maxW) {
            return f1;
        }
        if (f2 != null && dc.getTextWidthInPixels(txt, f2) <= maxW) {
            return f2;
        }
        return (f3 != null) ? f3 : Graphics.FONT_XTINY;
    }

    (:typecheck(false))
    function drawCrispBox(
        dc as Graphics.Dc,
        x as Lang.Number,
        y as Lang.Number,
        bw as Lang.Number,
        bh as Lang.Number,
        rad as Lang.Number,
        fillCol as Lang.Number,
        borderCol as Lang.Number,
        strokePx as Lang.Number
    ) as Void {
        dc.setColor(fillCol, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(x, y, bw, bh, rad);
        if (dc has :setPenWidth) {
            dc.setPenWidth(strokePx);
        }
        dc.setColor(borderCol, Graphics.COLOR_TRANSPARENT);
        dc.drawRoundedRectangle(x, y, bw, bh, rad);
        if (dc has :setPenWidth) {
            dc.setPenWidth(1);
        }
    }

    (:typecheck(false))
    function drawArchery101010Header(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number, s as Lang.Float, statusLabel as Lang.String, compact as Lang.Boolean) as Void {
        var cx = w / 2;
        var strokePx = (w >= 340) ? 2 : 1;
        var fMicro = (mFontMicro != null) ? mFontMicro : Graphics.FONT_XTINY;

        // 1. Official Good Times + Geometric 101010 Bitmap Logo (mathematically inside top circular chord)
        var logoTopY = ((compact ? 19.0 : 22.0) * s).toNumber();
        var logoBottomY = logoTopY + (12.0 * s).toNumber();
        if (mBrandLogo != null) {
            var lw = mBrandLogo.getWidth();
            var lh = mBrandLogo.getHeight();
            dc.drawBitmap(cx - (lw / 2), logoTopY, mBrandLogo);
            logoBottomY = logoTopY + lh;
        } else {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, logoTopY + (6.0 * s).toNumber(), fMicro, "ARCHERY 101010", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // 2. Auto-Fitted Status Pill (never overflows or touches border on any resolution)
        var pillY = logoBottomY + ((compact ? 4.0 : 6.0) * s).toNumber();
        var fontH = dc.getFontHeight(fMicro);
        var minPillH = ((compact ? 15.0 : 17.0) * s).toNumber();
        var pillH = fontH + (1.0 * s).toNumber();
        if (pillH < minPillH) {
            pillH = minPillH;
        }

        var textW = dc.getTextWidthInPixels(statusLabel, fMicro);
        var minPillW = ((compact ? 96.0 : 112.0) * s).toNumber();
        var maxPillW = ((compact ? 156.0 : 168.0) * s).toNumber();
        var pillW = textW + (20.0 * s).toNumber();
        if (pillW < minPillW) { pillW = minPillW; }
        if (pillW > maxPillW) { pillW = maxPillW; }
        var pillX = cx - (pillW / 2);

        var isYellow = (statusLabel.find("CAMINANDO") != null)
            || (statusLabel.find("WALKING") != null)
            || (statusLabel.find("EDIT") != null)
            || (statusLabel.find("ENVIADO") != null)
            || (statusLabel.find("SAVED") != null);
        var isMuted = (statusLabel.find("LOCAL") != null)
            || (statusLabel.find("SIN VINCULAR") != null)
            || (statusLabel.find("TAP TO LINK") != null)
            || (statusLabel.find("TOCA PARA") != null);
        var fillCol = isYellow ? 0x121106 : (isMuted ? 0x0A0D13 : 0x050D17);
        var borderCol = isYellow ? 0xFFE500 : (isMuted ? 0x475569 : 0x00A8F3);

        drawCrispBox(dc, pillX, pillY, pillW, pillH, pillH / 2, fillCol, borderCol, strokePx);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, pillY + (pillH / 2), fMicro, statusLabel, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function drawPagerDots(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number, s as Lang.Float) as Void {
        var cx = w / 2;
        var dotY = h - (15.0 * s).toNumber();
        var activeW = (11.0 * s).toNumber();
        var inactiveW = (4.0 * s).toNumber();
        var dotH = (4.0 * s).toNumber();
        var gap = (4.0 * s).toNumber();
        var totalW = activeW + (4 * inactiveW) + (4 * gap);
        var curX = cx - (totalW / 2);

        for (var i = 0; i < 5; i++) {
            var itemW = (i == screenIdx) ? activeW : inactiveW;
            dc.setColor((i == screenIdx) ? 0x00A8F3 : 0x334155, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(curX, dotY - (dotH / 2), itemW, dotH, dotH / 2);
            curX = curX + itemW + gap;
        }
    }

    public var lastScreenWidth = 240;
    public var lastScreenHeight = 240;
    public var lastPadStartX = 25;
    public var lastPadStartY = 55;
    public var lastKeyW = 44;
    public var lastKeyH = 37;
    public var lastKeyGap = 4;
    public var lastActY = 180;
    public var lastActH = 26;

    (:typecheck(false))
    function onUpdate(dc as Graphics.Dc) as Void {
        recalculateMetrics();
        var w = dc.getWidth();
        var h = dc.getHeight();
        lastScreenWidth = w;
        lastScreenHeight = h;
        var minDim = (w < h) ? w : h;
        var s = minDim / 240.0;
        var cx = w / 2;
        var strokePx = (w >= 340) ? 2 : 1;
        var isConnectedNow = (isCloudSynced || isBleConnected);

        var fMicro = (mFontMicro != null) ? mFontMicro : Graphics.FONT_XTINY;
        var fLabel = (mFontLabel != null) ? mFontLabel : Graphics.FONT_XTINY;
        var fValue = (mFontValue != null) ? mFontValue : Graphics.FONT_SMALL;
        var fHero = (mFontHero != null) ? mFontHero : Graphics.FONT_NUMBER_MEDIUM;

        // Matte OLED Black Background
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var mts = distanceWalkedM;
        var walkedPrimaryStr = formatWalkedPrimary(mts);
        var walkedDualStr = formatWalkedDual(mts);
        var maxPillTxtW = (148.0 * s).toNumber();

        if (screenIdx == 0) {
            var pillTxt = isConnectedNow
                ? tr("CONECTADO · LIVE", "SYNCED · LIVE")
                : tr("MODO MANUAL", "MANUAL MODE");
            if (dc.getTextWidthInPixels(pillTxt, fMicro) > maxPillTxtW) {
                pillTxt = isConnectedNow ? tr("CONECTADO", "SYNCED") : "MANUAL";
            }
            drawArchery101010Header(dc, w, h, s, pillTxt, true);

            var d3 = (arrowsCount / 1000) % 10;
            var d2 = (arrowsCount / 100) % 10;
            var d1 = (arrowsCount / 10) % 10;
            var d0 = arrowsCount % 10;
            var digits = [d3, d2, d1, d0] as Lang.Array<Lang.Number>;

            var boxW = (37.0 * s).toNumber();
            var boxH = (50.0 * s).toNumber();
            var gap = (5.0 * s).toNumber();
            var totalW = (boxW * 4) + (gap * 3);
            var startX = cx - (totalW / 2);
            var startY = (60.0 * s).toNumber();

            for (var i = 0; i < 4; i++) {
                var rx = startX + i * (boxW + gap);
                var cellFill = (i == 3) ? 0x121107 : 0x0B0E15;
                var cellBorder = (i == 3) ? 0xFFE500 : 0x3E4756;
                drawCrispBox(dc, rx, startY, boxW, boxH, (7.0 * s).toNumber(), cellFill, cellBorder, strokePx);

                dc.setColor((i == 3) ? 0xFFE500 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(rx + (boxW / 2), startY + (boxH / 2), fHero, digits[i].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Symmetrical XL Manual Counter Row: [  -1  ]  [  +1  ] aligned edge-to-edge with 4-digit chassis
            var rowY = (118.0 * s).toNumber();
            var rowW = totalW;
            var btnGap = (7.0 * s).toNumber();
            var btnW = (rowW - btnGap) / 2;
            var btnH = (36.0 * s).toNumber();
            var btnRad = (10.0 * s).toNumber();

            var minusX = cx - (rowW / 2);
            drawCrispBox(dc, minusX, rowY, btnW, btnH, btnRad, 0x180709, 0xFF1E1E, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(minusX + (btnW / 2), rowY + (btnH / 2), fValue, "-1", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var plusX = cx + (rowW / 2) - btnW;
            drawCrispBox(dc, plusX, rowY, btnW, btnH, btnRad, 0x061523, 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(plusX + (btnW / 2), rowY + (btnH / 2), fValue, "+1", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            // Dedicated Bottom Telemetry Lines (100% separated vertically below XL buttons)
            var telemStr = walkedPrimaryStr + " · " + activeKcal.toString() + " kcal";
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, ((minDim > 180 ? 168.0 : 172.0) * s).toNumber(), fMicro, telemStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            if (minDim > 180) {
                var endDistStr = tr("TANDA ", "END ") + currentEnd.toString() + " · " + distanceM.toString() + " M";
                dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, (186.0 * s).toNumber(), fMicro, endDistStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

        } else if (screenIdx == 1) {
            // OPCIÓN A: XL 4x3 Score Keypad (2x tactile area across all 11 Garmin screen sizes)
            var isMono = (minDim <= 180);

            // 1. Official ARCHERY 101010 Logo mathematically inside top circular chord
            var logoTopY = (19.0 * s).toNumber();
            var logoBottomY = logoTopY + (11.0 * s).toNumber();
            if (mBrandLogo != null) {
                var lw = mBrandLogo.getWidth();
                var lh = mBrandLogo.getHeight();
                dc.drawBitmap(cx - (lw / 2), logoTopY, mBrandLogo);
                logoBottomY = logoTopY + lh;
            } else {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, logoTopY + (5.0 * s).toNumber(), fMicro, "ARCHERY 101010", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // 2. Unified Compact Score + End Arrow Slots Row: [T1·29P / E1·29P] [X][10][9][-][-][-]
            var microH = dc.getFontHeight(fMicro);
            var barY = logoBottomY + (3.5 * s).toNumber();
            var barH = (16.5 * s).toNumber();
            if (barH < (microH + 2)) {
                barH = microH + 2;
            }

            var maxBarW = ((isMono ? 148.0 : 154.0) * s).toNumber();
            var endTagPrefix = tr("T", "E");
            var ptsStr = endTagPrefix + currentEnd.toString() + "·" + totalScore.toString() + "P";
            var ptsTextW = dc.getTextWidthInPixels(ptsStr, fMicro);
            var ptsTagW = ptsTextW + (9.0 * s).toNumber();
            var maxPtsTagW = (62.0 * s).toNumber();
            if (ptsTagW > maxPtsTagW) {
                ptsStr = endTagPrefix + currentEnd.toString() + "·" + totalScore.toString();
                ptsTextW = dc.getTextWidthInPixels(ptsStr, fMicro);
                ptsTagW = ptsTextW + (8.0 * s).toNumber();
            }

            var slotCount = (arrowsPerEnd < 6) ? arrowsPerEnd : 6;
            if (slotCount < 1) { slotCount = 6; }
            var barGap = (4.0 * s).toNumber();
            if (barGap < 2) { barGap = 2; }
            var sGap = (2.5 * s).toNumber();
            if (sGap < 2) { sGap = 2; }

            var slotsAvailW = maxBarW - ptsTagW - barGap;
            var slotW = (slotsAvailW - ((slotCount - 1) * sGap)) / slotCount;
            var maxSlotW = (22.0 * s).toNumber();
            if (slotW > maxSlotW) { slotW = maxSlotW; }
            if (slotW < 10) { slotW = 10; }

            var slotsActualW = (slotCount * slotW) + ((slotCount - 1) * sGap);
            var totalBarW = ptsTagW + barGap + slotsActualW;
            var barStartX = cx - (totalBarW / 2);

            drawCrispBox(
                dc,
                barStartX,
                barY,
                ptsTagW,
                barH,
                barH / 2,
                isMono ? 0x000000 : 0x050D17,
                isMono ? 0xFFFFFF : 0x00A8F3,
                strokePx
            );
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(barStartX + (ptsTagW / 2), barY + (barH / 2), fMicro, ptsStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var slotsStartX = barStartX + ptsTagW + barGap;
            for (var si = 0; si < slotCount; si++) {
                var sx = slotsStartX + si * (slotW + sGap);
                var hasVal = (si < currentEndArrows.size());
                var sVal = hasVal ? currentEndArrows[si] : "-";
                var sBorder = isMono
                    ? 0xFFFFFF
                    : (hasVal
                        ? ((sVal.equals("X") || sVal.equals("10") || sVal.equals("9")) ? 0xFFE500 : ((sVal.equals("8") || sVal.equals("7")) ? 0xFF1E1E : ((sVal.equals("6") || sVal.equals("5")) ? 0x00A8F3 : 0x94A3B8)))
                        : 0x334155);
                var sTxtCol = isMono
                    ? 0xFFFFFF
                    : (hasVal ? ((sVal.equals("X") || sVal.equals("10") || sVal.equals("9")) ? 0xFFE500 : Graphics.COLOR_WHITE) : 0x64748B);
                drawCrispBox(dc, sx, barY, slotW, barH, (3.8 * s).toNumber(), isMono ? 0x000000 : 0x07090E, sBorder, 1);
                dc.setColor(sTxtCol, Graphics.COLOR_TRANSPARENT);
                dc.drawText(sx + (slotW / 2), barY + (barH / 2), fMicro, sVal, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // 3. Bottom Action Pills anchored cleanly above pager dots so XL keypad gets full equatorial height
            var actH = (26.0 * s).toNumber();
            if (actH < (microH + 4)) { actH = microH + 4; }
            var pagerClearance = (33.0 * s).toNumber();
            var actY = h - pagerClearance - actH;

            // 4. 12 XL Tactile Score Keys (4x3: X, 10..1, M) — ~2x area across full equatorial chord
            var padW = ((isMono ? 168.0 : 190.0) * s).toNumber();
            var kGap = (4.0 * s).toNumber();
            if (kGap < 2) { kGap = 2; }
            var kStartY = barY + barH + (4.2 * s).toNumber();
            var kEndY = actY - (4.2 * s).toNumber();
            var gridAvailH = kEndY - kStartY;
            var keyW = (padW - (3 * kGap)) / 4;
            var keyH = (gridAvailH - (2 * kGap)) / 3;
            if (keyH < (18.0 * s).toNumber()) {
                keyH = (18.0 * s).toNumber();
            }
            var kStartX = cx - (padW / 2);

            lastPadStartX = kStartX;
            lastPadStartY = kStartY;
            lastKeyW = keyW;
            lastKeyH = keyH;
            lastKeyGap = kGap;
            lastActY = actY;
            lastActH = actH;

            for (var k = 0; k < 12; k++) {
                var r = k / 4;
                var c = k % 4;
                var kx = kStartX + c * (keyW + kGap);
                var ky = kStartY + r * (keyH + kGap);
                var isSel = (k == selectedScoreIdx);

                var bgCol = isMono
                    ? (isSel ? 0xFFFFFF : 0x000000)
                    : ((k < 3) ? 0x121107 : ((k < 5) ? 0x160708 : ((k < 7) ? 0x061320 : 0x0B0E15)));
                var borderCol = isMono
                    ? 0xFFFFFF
                    : (isSel ? 0xFFFFFF : ((k < 3) ? 0xFFE500 : ((k < 5) ? 0xFF1E1E : ((k < 7) ? 0x00A8F3 : 0x475569))));
                var txtCol = isMono
                    ? (isSel ? 0x000000 : 0xFFFFFF)
                    : ((k < 3) ? 0xFFE500 : ((k == 11) ? 0xCBD5E1 : Graphics.COLOR_WHITE));
                var kStroke = (!isMono && isSel) ? (strokePx + 1) : strokePx;

                drawCrispBox(dc, kx, ky, keyW, keyH, (6.5 * s).toNumber(), bgCol, borderCol, kStroke);
                var keyFont = pickFittingFont(dc, scoreLabels[k], keyW - (6.0 * s).toNumber(), fValue, fLabel, fMicro);
                dc.setColor(txtCol, Graphics.COLOR_TRANSPARENT);
                dc.drawText(kx + (keyW / 2), ky + (keyH / 2), keyFont, scoreLabels[k], Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // 5. Bottom Actions: [ BORRAR / DEL ]   [ SIG. TANDA / NEXT END ]
            var actGap = (6.0 * s).toNumber();
            var actWTotal = ((isMono ? 148.0 : 158.0) * s).toNumber();
            var actStartX = cx - (actWTotal / 2);
            var actW = (actWTotal - actGap) / 2;
            var actBtnInnerW = actW - (8.0 * s).toNumber();

            var delLbl = tr("BORRAR", "DEL");
            drawCrispBox(dc, actStartX, actY, actW, actH, actH / 2, isMono ? 0x000000 : 0x0B0E15, isMono ? 0xFFFFFF : 0x475569, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(actStartX + (actW / 2), actY + (actH / 2), fMicro, delLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var nextFull = tr("SIG. TANDA", "NEXT END");
            var nextShort = tr("SIG.", "NEXT");
            var nextLbl = (dc.getTextWidthInPixels(nextFull, fMicro) <= actBtnInnerW) ? nextFull : nextShort;
            var nextX = actStartX + actW + actGap;
            drawCrispBox(dc, nextX, actY, actW, actH, actH / 2, isMono ? 0x000000 : 0x061523, isMono ? 0xFFFFFF : 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(nextX + (actW / 2), actY + (actH / 2), fMicro, nextLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 2) {
            drawArchery101010Header(dc, w, h, s, tr("BIOMETRÍA", "BIOMETRICS"), false);

            var cardW = (164.0 * s).toNumber();
            var cardH = (44.0 * s).toNumber();
            var cardX = cx - (cardW / 2);
            var card1Y = (68.0 * s).toNumber();
            var card2Y = (119.0 * s).toNumber();
            var innerMaxW = cardW - (14.0 * s).toNumber();

            drawCrispBox(dc, cardX, card1Y, cardW, cardH, (9.0 * s).toNumber(), 0x07090E, 0x00A8F3, strokePx);
            var distHdrFull = tr("DISTANCIA · ", "DISTANCE · ") + stepsCount.toString() + tr(" PASOS", " STEPS");
            var distHdrShort = stepsCount.toString() + tr(" PASOS", " STEPS");
            var distHdr = (dc.getTextWidthInPixels(distHdrFull, fMicro) <= innerMaxW) ? distHdrFull : distHdrShort;
            dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card1Y + (13.0 * s).toNumber(), fMicro, distHdr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            var distFont = pickFittingFont(dc, walkedDualStr, innerMaxW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card1Y + (30.0 * s).toNumber(), distFont, walkedDualStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            drawCrispBox(dc, cardX, card2Y, cardW, cardH, (9.0 * s).toNumber(), 0x07090E, 0xFF1E1E, strokePx);
            dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card2Y + (13.0 * s).toNumber(), fMicro, tr("ENERGÍA", "ENERGY"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            var kcalStr = activeKcal.toString() + " kcal";
            var kcalFont = pickFittingFont(dc, kcalStr, innerMaxW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card2Y + (30.0 * s).toNumber(), kcalFont, kcalStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var bioFootFull = arrowsCount.toString() + tr(" FLECHAS · ", " ARROWS · ") + bowPoundageLbs.toString() + " LBS";
            var bioFootShort = arrowsCount.toString() + tr(" FL · ", " AR · ") + bowPoundageLbs.toString() + " LBS";
            var bioFoot = (dc.getTextWidthInPixels(bioFootFull, fMicro) <= innerMaxW) ? bioFootFull : bioFootShort;
            dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (177.0 * s).toNumber(), fMicro, bioFoot, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 3) {
            var justSaved = (lastSavedFeedbackMs > 0) && (System.getTimer() < lastSavedFeedbackMs);
            var sumStatus = justSaved
                ? tr("ENVIADO", "SAVED")
                : (isConnectedNow ? tr("RESUMEN · SYNC", "SUMMARY · SYNC") : tr("RESUMEN", "SUMMARY"));
            drawArchery101010Header(dc, w, h, s, sumStatus, false);

            var sumW = (164.0 * s).toNumber();
            var sumX = cx - (sumW / 2);
            var sumY = (70.0 * s).toNumber();
            var sumH = (72.0 * s).toNumber();
            var sumInnerW = sumW - (14.0 * s).toNumber();
            var halfW = (sumW / 2) - (8.0 * s).toNumber();
            var leftColCx = sumX + (sumW / 4);
            var rightColCx = sumX + ((sumW * 3) / 4);

            drawCrispBox(dc, sumX, sumY, sumW, sumH, (10.0 * s).toNumber(), 0x07090E, isConnectedNow ? 0x00A8F3 : 0xFFE500, strokePx);

            dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(leftColCx, sumY + (12.0 * s).toNumber(), fMicro, tr("FLECHAS", "ARROWS"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.drawText(rightColCx, sumY + (12.0 * s).toNumber(), fMicro, tr("PUNTAJE", "SCORE"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var arrValStr = arrowsCount.toString();
            var arrFont = pickFittingFont(dc, arrValStr, halfW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(leftColCx, sumY + (30.0 * s).toNumber(), arrFont, arrValStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var ptsValStr = totalScore.toString();
            var ptsFont = pickFittingFont(dc, ptsValStr, halfW, fValue, fLabel, fMicro);
            dc.setColor(0xFFE500, Graphics.COLOR_TRANSPARENT);
            dc.drawText(rightColCx, sumY + (30.0 * s).toNumber(), ptsFont, ptsValStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            dc.setColor(0x1E293B, Graphics.COLOR_TRANSPARENT);
            dc.drawLine(cx, sumY + (7.0 * s).toNumber(), cx, sumY + (41.0 * s).toNumber());
            dc.drawLine(sumX + (12.0 * s).toNumber(), sumY + (45.0 * s).toNumber(), sumX + sumW - (12.0 * s).toNumber(), sumY + (45.0 * s).toNumber());

            var line2 = walkedPrimaryStr + " · " + activeKcal.toString() + " kcal";
            var line2Font = pickFittingFont(dc, line2, sumInnerW, fMicro, fMicro, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, sumY + (58.0 * s).toNumber(), line2Font, line2, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var ctaTotalW = (154.0 * s).toNumber();
            var ctaGap = (6.0 * s).toNumber();
            var ctaBtnW = (ctaTotalW - ctaGap) / 2;
            var ctaH = (26.0 * s).toNumber();
            var ctaStartX = cx - (ctaTotalW / 2);
            var ctaY = (152.0 * s).toNumber();

            drawCrispBox(dc, ctaStartX, ctaY, ctaBtnW, ctaH, ctaH / 2, 0x0B0E15, 0x475569, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(ctaStartX + (ctaBtnW / 2), ctaY + (ctaH / 2), fMicro, tr("NUEVA", "RESET"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var saveBtnX = ctaStartX + ctaBtnW + ctaGap;
            var saveBtnLbl = justSaved ? tr("ENVIADO", "SAVED") : tr("GUARDAR", "SAVE");
            drawCrispBox(dc, saveBtnX, ctaY, ctaBtnW, ctaH, ctaH / 2, 0x061523, justSaved ? 0xFFE500 : 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(saveBtnX + (ctaBtnW / 2), ctaY + (ctaH / 2), fMicro, saveBtnLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else {
            // SCREEN 4: 6-DIGIT CLOUD PAIRING CODE PICKER
            var pairHeader = isEditingCode
                ? (tr("EDITAR ", "EDIT ") + (editDigitPos + 1).toString() + "/6")
                : (isCloudSynced
                    ? tr("VINCULADO", "SYNCED")
                    : (hasPairingCode ? tr("CÓDIGO NUBE", "CLOUD CODE") : tr("TOCA PARA VINCULAR", "TAP TO LINK")));
            if (dc.getTextWidthInPixels(pairHeader, fMicro) > maxPillTxtW) {
                pairHeader = isEditingCode
                    ? ("EDIT " + (editDigitPos + 1).toString() + "/6")
                    : (isCloudSynced ? tr("VINCULADO", "SYNCED") : tr("CÓDIGO NUBE", "CLOUD CODE"));
            }
            drawArchery101010Header(dc, w, h, s, pairHeader, false);

            var dBoxW = (23.0 * s).toNumber();
            var dBoxH = (38.0 * s).toNumber();
            var dGap = (4.0 * s).toNumber();
            var dTotalW = (dBoxW * 6) + (dGap * 5);
            var dStartX = cx - (dTotalW / 2);
            var dStartY = (69.0 * s).toNumber();

            for (var di = 0; di < 6; di++) {
                var dx = dStartX + di * (dBoxW + dGap);
                var isCurDigit = (di == editDigitPos);
                drawCrispBox(dc, dx, dStartY, dBoxW, dBoxH, (5.0 * s).toNumber(), isCurDigit ? 0x081523 : 0x0B0E15, isCurDigit ? 0x00A8F3 : 0xFFE500, strokePx);
                dc.setColor(isCurDigit ? Graphics.COLOR_WHITE : 0xFFE500, Graphics.COLOR_TRANSPARENT);
                dc.drawText(dx + (dBoxW / 2), dStartY + (dBoxH / 2), fValue, pairingDigits[di].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Touch & Button Row: [-] | [EDITAR > / EDIT >] | [+]
            var ctrlY = (116.0 * s).toNumber();
            var ctrlH = (25.0 * s).toNumber();
            var ctrlW = (156.0 * s).toNumber();
            var cStartX = cx - (ctrlW / 2);
            var smallW = (36.0 * s).toNumber();
            var btnGap = (6.0 * s).toNumber();
            var midW = ctrlW - (2 * smallW) - (2 * btnGap);

            drawCrispBox(dc, cStartX, ctrlY, smallW, ctrlH, ctrlH / 2, 0x180709, 0xFF1E1E, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cStartX + (smallW / 2), ctrlY + (ctrlH / 2), fLabel, "-", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var midX = cStartX + smallW + btnGap;
            var midLbl = isEditingCode ? tr("EDITAR >", "EDIT >") : tr("EDITAR", "EDIT");
            if (dc.getTextWidthInPixels(midLbl, fMicro) > (midW - (6.0 * s).toNumber())) {
                midLbl = tr("EDIT >", "EDIT >");
            }
            drawCrispBox(dc, midX, ctrlY, midW, ctrlH, ctrlH / 2, 0x0B0E15, 0x475569, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(midX + (midW / 2), ctrlY + (ctrlH / 2), fMicro, midLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var plusBtnX = midX + midW + btnGap;
            drawCrispBox(dc, plusBtnX, ctrlY, smallW, ctrlH, ctrlH / 2, 0x061523, 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(plusBtnX + (smallW / 2), ctrlY + (ctrlH / 2), fLabel, "+", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            // Save & Sync CTA
            var saveW = (146.0 * s).toNumber();
            var saveH = (25.0 * s).toNumber();
            var saveX = cx - (saveW / 2);
            var saveY = (149.0 * s).toNumber();
            var saveLbl = isEditingCode
                ? tr("LISTO", "DONE")
                : (isCloudSynced ? tr("VINCULADO", "SYNCED") : tr("TOCA PARA VINCULAR", "TAP TO LINK"));
            if (dc.getTextWidthInPixels(saveLbl, fMicro) > (saveW - (10.0 * s).toNumber())) {
                saveLbl = isEditingCode
                    ? tr("LISTO", "DONE")
                    : (isCloudSynced ? tr("VINCULADO", "SYNCED") : tr("CÓDIGO NUBE", "CLOUD CODE"));
            }
            drawCrispBox(dc, saveX, saveY, saveW, saveH, saveH / 2, 0x061523, isCloudSynced ? 0xFFE500 : 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, saveY + (saveH / 2), fMicro, saveLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        drawPagerDots(dc, w, h, s);
    }
}

class Archery101010WatchDelegate extends WatchUi.BehaviorDelegate {
    private var mView as Archery101010WatchView;

    function initialize(view as Archery101010WatchView) {
        BehaviorDelegate.initialize();
        mView = view;
    }

    function onSelect() {
        if (mView.screenIdx == 0) {
            mView.incrementArrow(1, false);
        } else if (mView.screenIdx == 1) {
            var val = mView.scoreLabels[mView.selectedScoreIdx];
            mView.recordScoreInput(val);
        } else if (mView.screenIdx == 2) {
            mView.markUserActivity(true);
            mView.syncWithPhoneApp("SYNC_TELEMETRY_FROM_WATCH", null);
        } else if (mView.screenIdx == 3) {
            mView.finishSessionAndReset();
        } else if (mView.screenIdx == 4) {
            if (!mView.isEditingCode) {
                mView.isEditingCode = true;
                mView.editDigitPos = 0;
                mView.markUserActivity(true);
                WatchUi.requestUpdate();
            } else if (mView.editDigitPos < 5) {
                mView.editDigitPos = mView.editDigitPos + 1;
                mView.markUserActivity(true);
                WatchUi.requestUpdate();
            } else {
                mView.commitPairingDigits();
            }
        }
        return true;
    }

    function onNextPage() {
        if (mView.screenIdx == 4 && mView.isEditingCode) {
            mView.adjustSelectedCodeDigit(-1);
            return true;
        }
        mView.screenIdx = (mView.screenIdx + 1) % 5;
        mView.markUserActivity(false);
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() {
        if (mView.screenIdx == 4 && mView.isEditingCode) {
            mView.adjustSelectedCodeDigit(1);
            return true;
        }
        mView.screenIdx = (mView.screenIdx + 4) % 5;
        mView.markUserActivity(false);
        WatchUi.requestUpdate();
        return true;
    }

    function onSwipe(swipeEvent) {
        if (swipeEvent == null) {
            return false;
        }
        var dir = swipeEvent.getDirection();
        if (dir == WatchUi.SWIPE_LEFT) {
            mView.isEditingCode = false;
            mView.screenIdx = (mView.screenIdx + 1) % 5;
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        } else if (dir == WatchUi.SWIPE_RIGHT) {
            if (mView.screenIdx == 4 && mView.isEditingCode) {
                mView.isEditingCode = false;
            } else {
                mView.screenIdx = (mView.screenIdx + 4) % 5;
            }
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        }
        return false;
    }

    function onBack() {
        if (mView.screenIdx == 4 && mView.isEditingCode) {
            mView.isEditingCode = false;
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        }
        if (mView.screenIdx > 0) {
            mView.screenIdx = mView.screenIdx - 1;
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        }
        return false;
    }

    function onMenu() {
        if (mView.screenIdx == 1) {
            mView.advanceNextEnd();
            return true;
        }
        mView.markUserActivity(false);
        return true;
    }

    function onTap(clickEvent) {
        var coords = clickEvent.getCoordinates();
        if (coords == null || coords.size() < 2) {
            return false;
        }
        var tx = coords[0];
        var ty = coords[1];
        var w = mView.lastScreenWidth;
        var h = mView.lastScreenHeight;
        var minDim = (w < h) ? w : h;
        var s = minDim / 240.0;
        var cx = w / 2;

        // Bottom pager dots tap switches screen
        if (ty >= (h - (28.0 * s))) {
            mView.isEditingCode = false;
            mView.screenIdx = (mView.screenIdx + 1) % 5;
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        }

        if (mView.screenIdx == 0) {
            // Deliberate XL side-by-side -1 / +1 buttons (prevents accidental wrist/sleeve/arrow touches on 0000 chassis)
            if (ty >= (114.0 * s) && ty <= (160.0 * s)) {
                if (tx < (cx - (2.5 * s))) {
                    if (mView.arrowsCount > 0) {
                        mView.incrementArrow(-1, false);
                    } else {
                        mView.markUserActivity(false);
                    }
                    return true;
                } else if (tx > (cx + (2.5 * s))) {
                    mView.incrementArrow(1, false);
                    return true;
                }
            } else if (ty > (160.0 * s) && ty < (h - (28.0 * s))) {
                mView.screenIdx = 2;
                mView.markUserActivity(false);
                WatchUi.requestUpdate();
                return true;
            }
        } else if (mView.screenIdx == 1) {
            var kStartX = mView.lastPadStartX;
            var kStartY = mView.lastPadStartY;
            var keyW = mView.lastKeyW;
            var keyH = mView.lastKeyH;
            var kGap = mView.lastKeyGap;
            var halfGap = kGap / 2;

            for (var k = 0; k < 12; k++) {
                var r = k / 4;
                var c = k % 4;
                var kx = kStartX + c * (keyW + kGap);
                var ky = kStartY + r * (keyH + kGap);
                if (tx >= (kx - halfGap) && tx <= (kx + keyW + halfGap) && ty >= (ky - halfGap) && ty <= (ky + keyH + halfGap)) {
                    mView.selectedScoreIdx = k;
                    mView.recordScoreInput(mView.scoreLabels[k]);
                    return true;
                }
            }

            // Bottom BORRAR | SIG. TANDA touch buttons
            var actTop = mView.lastActY - (2.0 * s);
            var actBot = mView.lastActY + mView.lastActH + (3.0 * s);
            if (ty >= actTop && ty <= actBot) {
                if (tx < cx) {
                    mView.undoLastScore();
                } else {
                    mView.advanceNextEnd();
                }
                return true;
            }
        } else if (mView.screenIdx == 2) {
            mView.markUserActivity(true);
            mView.syncWithPhoneApp("SYNC_TELEMETRY_FROM_WATCH", null);
            return true;
        } else if (mView.screenIdx == 3) {
            if (ty >= (148.0 * s) && ty <= (186.0 * s)) {
                if (tx < cx) {
                    mView.resetSessionFromWatch();
                } else {
                    mView.finishSessionAndReset();
                }
                return true;
            }
        } else if (mView.screenIdx == 4) {
            // Digit boxes tap: select or increment digit
            var dBoxW = 23.0 * s;
            var dBoxH = 38.0 * s;
            var dGap = 4.0 * s;
            var dTotalW = (dBoxW * 6.0) + (dGap * 5.0);
            var dStartX = cx - (dTotalW / 2.0);
            var dStartY = 69.0 * s;

            if (ty >= dStartY && ty <= (dStartY + dBoxH)) {
                for (var di = 0; di < 6; di++) {
                    var dx = dStartX + di * (dBoxW + dGap);
                    if (tx >= dx && tx <= (dx + dBoxW)) {
                        mView.isEditingCode = true;
                        if (mView.editDigitPos == di) {
                            mView.adjustSelectedCodeDigit(1);
                        } else {
                            mView.editDigitPos = di;
                            mView.markUserActivity(true);
                            WatchUi.requestUpdate();
                        }
                        return true;
                    }
                }
            }

            // [-] | [EDITAR > / EDIT >] | [+] row
            if (ty >= (113.0 * s) && ty <= (144.0 * s)) {
                mView.isEditingCode = true;
                if (tx < (cx - (34.0 * s))) {
                    mView.adjustSelectedCodeDigit(-1);
                } else if (tx > (cx + (34.0 * s))) {
                    mView.adjustSelectedCodeDigit(1);
                } else {
                    mView.editDigitPos = (mView.editDigitPos + 1) % 6;
                    mView.markUserActivity(true);
                    WatchUi.requestUpdate();
                }
                return true;
            }

            // LISTO / DONE / VINCULAR button
            if (ty >= (146.0 * s) && ty <= (182.0 * s)) {
                mView.commitPairingDigits();
                return true;
            }
        }
        mView.markUserActivity(false);
        return false;
    }
}

class CommListener extends Communications.ConnectionListener {
    private var mParentView as Archery101010WatchView?;

    function initialize(view as Archery101010WatchView?) {
        ConnectionListener.initialize();
        mParentView = view;
    }

    function onComplete() {
        if (mParentView != null && !mParentView.isBleConnected) {
            mParentView.isBleConnected = true;
            WatchUi.requestUpdate();
        }
    }

    function onError() {
        if (mParentView != null && mParentView.isBleConnected) {
            mParentView.isBleConnected = false;
            WatchUi.requestUpdate();
        }
    }
}
