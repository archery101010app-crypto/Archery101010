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

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        if (Communications has :registerForPhoneAppMessages) {
            try {
                Communications.registerForPhoneAppMessages(method(:onPhoneMessage));
            } catch (ex) {}
        }
    }

    function onStop(state) {
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
        if (Sensor has :unregisterSensorDataListener) {
            try {
                Sensor.unregisterSensorDataListener();
            } catch (ex) {}
        }
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
    public var autoDetectEnabled = true;
    public var sensitivityLevel = 1; // 0: BAJA, 1: MEDIA, 2: ALTA
    public var selectedScoreIdx = 0; // 0..11
    public var scoreLabels as Lang.Array<Lang.String> = ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"];
    public var currentEndArrows as Lang.Array<Lang.String> = [] as Lang.Array<Lang.String>;
    public var currentSessionId = "";

    // 6-Digit Cloud Sync state
    public var pairingDigits as Lang.Array<Lang.Number> = [1, 0, 1, 0, 1, 0];
    public var hasPairingCode = false;
    public var pairingCode = "";
    public var isEditingCode = false;
    public var editDigitPos = 0;
    public var isCloudSynced = false;
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
    private var mLastLocalActionMs = 0;
    private var mLastCloudPollMs = 0;
    private var mLastTelemetryPushSteps = 0;
    private var mSensorTimer = null;

    // Official Good Times + Geometric 101010 BrandLogo & Bundled Outfit Athletic Fonts
    private var mBrandLogo = null;
    private var mFontMicro = null;
    private var mFontLabel = null;
    private var mFontValue = null;
    private var mFontHero = null;

    function initialize() {
        View.initialize();
        loadBrandResources();
        loadStateFromStorage();
        initStepBaseline();
        registerHighFreqAccelerometer();

        mSensorTimer = new Timer.Timer();
        mSensorTimer.start(method(:onSensorTick), 100, true);

        if (hasPairingCode && pairingCode.length() == 6) {
            pollFirestoreCloud();
        }
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
            var ad = Application.Storage.getValue("autoDetectEnabled");
            if (ad != null && ad instanceof Lang.Boolean) { autoDetectEnabled = ad; }
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
            Application.Storage.setValue("autoDetectEnabled", autoDetectEnabled);
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
        saveStateToStorage();
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(70, 60)]);
        }
        pollFirestoreCloud();
        syncWithFirestoreCloud("SYNC_TELEMETRY_FROM_WATCH", null);
        WatchUi.requestUpdate();
    }

    function adjustSelectedCodeDigit(delta as Lang.Number) as Void {
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
        if (!autoDetectEnabled) {
            autoDetectEnabled = true;
            sensitivityLevel = 1; // MEDIA
        } else if (sensitivityLevel == 1) {
            sensitivityLevel = 0; // BAJA
        } else if (sensitivityLevel == 0) {
            sensitivityLevel = 2; // ALTA
        } else {
            autoDetectEnabled = false; // MODO MANUAL
        }
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(60, 40)]);
        }
        saveStateToStorage();
        syncWithPhoneApp("TOGGLE_AUTO_DETECT", null);
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
                    if ((stepsCount - mLastTelemetryPushSteps) >= 6 && hasPairingCode) {
                        mLastTelemetryPushSteps = stepsCount;
                        syncWithFirestoreCloud("SYNC_TELEMETRY_FROM_WATCH", null);
                    }
                    WatchUi.requestUpdate();
                } else if (mLastObservedSteps == null) {
                    mLastObservedSteps = curMonSteps;
                }
            }
        }

        // Poll 6-digit Cloud session every 8 seconds when paired
        if (hasPairingCode && pairingCode.length() == 6 && (now - mLastCloudPollMs) >= 8000) {
            mLastCloudPollMs = now;
            pollFirestoreCloud();
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
            if (data.hasKey("sessionActive") && data["sessionActive"] == false) {
                resetAllCounters("");
                return;
            }
            if (data.hasKey("sessionId") && data["sessionId"] != null) {
                var sid = data["sessionId"].toString();
                if (sid.length() > 0 && currentSessionId.length() > 0 && !sid.equals(currentSessionId)) {
                    resetAllCounters(sid);
                } else if (sid.length() > 0) {
                    currentSessionId = sid;
                }
            }
            if (data.hasKey("arrowsCount")) {
                arrowsCount = data["arrowsCount"].toNumber();
            }
            if (data.hasKey("totalScore")) {
                totalScore = data["totalScore"].toNumber();
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
                currentEnd = data["currentEndIndex"].toNumber() + 1;
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
            saveStateToStorage();
            WatchUi.requestUpdate();
        }
    }

    function updateGpsPosition(info as Position.Info?) as Void {
        if (info == null) {
            return;
        }
        // Prefer native elapsedDistance delta from session start without double-counting manual Haversine
        if ((info has :elapsedDistance) && info.elapsedDistance != null) {
            var curElapsed = info.elapsedDistance.toFloat();
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

        // Manual Haversine fallback ONLY when elapsedDistance is null AND GPS fix is QUALITY_USABLE or better
        if (info.accuracy != null && info.accuracy >= Position.QUALITY_USABLE && info.position != null) {
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
                if (stepM >= 1.8 && stepM <= 45.0) {
                    gpsDistanceM = gpsDistanceM + stepM;
                    mLastLat = lat;
                    mLastLon = lon;
                    recalculateMetrics();
                    WatchUi.requestUpdate();
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
            return;
        }
        mLastLocalActionMs = System.getTimer();
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
            return;
        }
        mLastLocalActionMs = System.getTimer();
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
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(85, 110)]);
        }
        syncWithPhoneApp("FINISH_SESSION_FROM_WATCH", null);
        resetAllCounters("");
        screenIdx = 0;
    }

    function recalculateMetrics() as Void {
        var distM = gpsDistanceM;
        if (stepsCount > 0) {
            var stepMeters = stepsCount * 0.76;
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
        // 1. Primary 6-Digit Cloud Sync via Firestore REST over HTTPS
        syncWithFirestoreCloud(eventType, extra);

        // 2. Secondary direct BLE phone app channel (safe try/catch)
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

    (:typecheck(false))
    function syncWithFirestoreCloud(eventType as Lang.String, extra) as Void {
        if (!hasPairingCode || pairingCode.length() != 6) {
            return;
        }
        mCmdSeq = mCmdSeq + 1;
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
            cmdFields["delta"] = { "integerValue" => "1" };
            cmdFields["source"] = { "stringValue" => src };
        } else if (eventType.equals("DECREMENT_ARROW")) {
            cmdFields["delta"] = { "integerValue" => "-1" };
            cmdFields["source"] = { "stringValue" => "watch_manual" };
            cmdFields["totalScore"] = { "integerValue" => totalScore.toString() };
        } else if (eventType.equals("SCORE_INPUT") && extra != null) {
            cmdFields["value"] = { "stringValue" => extra.toString() };
            cmdFields["totalScore"] = { "integerValue" => totalScore.toString() };
        } else if (eventType.equals("UNDO_ARROW")) {
            cmdFields["totalScore"] = { "integerValue" => totalScore.toString() };
        } else if (eventType.equals("TOGGLE_AUTO_DETECT")) {
            cmdFields["enabled"] = { "booleanValue" => autoDetectEnabled };
            cmdFields["sensitivityLevel"] = { "integerValue" => sensitivityLevel.toString() };
        } else if (eventType.equals("SYNC_TELEMETRY_FROM_WATCH")) {
            cmdFields["stepsCount"] = { "integerValue" => stepsCount.toString() };
            cmdFields["distanceWalkedM"] = { "integerValue" => distanceWalkedM.toString() };
            cmdFields["activeKcal"] = { "integerValue" => activeKcal.toString() };
        }

        var docFields = {
            "lastWatchCmd" => { "mapValue" => { "fields" => cmdFields } },
            "lastWatchCmdId" => { "stringValue" => cmdId },
            "lastWatchCmdSeq" => { "integerValue" => mCmdSeq.toString() },
            "watchStepsCount" => { "integerValue" => stepsCount.toString() },
            "watchDistanceM" => { "integerValue" => distanceWalkedM.toString() },
            "watchSource" => { "stringValue" => "GARMIN_CIQ" },
            "updatedAt" => { "integerValue" => epochMsStr }
        };

        var url =
            "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/" +
            pairingCode +
            "?updateMask.fieldPaths=lastWatchCmd&updateMask.fieldPaths=lastWatchCmdId&updateMask.fieldPaths=lastWatchCmdSeq&updateMask.fieldPaths=watchStepsCount&updateMask.fieldPaths=watchDistanceM&updateMask.fieldPaths=watchSource&updateMask.fieldPaths=updatedAt&currentDocument.exists=true";

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
    function onCloudPatchResponse(responseCode, data) as Void {
        if (responseCode >= 200 && responseCode < 300) {
            if (!isCloudSynced) {
                isCloudSynced = true;
                WatchUi.requestUpdate();
            }
        } else {
            if (isCloudSynced && responseCode != -101) {
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
        if (responseCode == 200 && data != null && (data instanceof Lang.Dictionary) && data.hasKey("fields")) {
            isCloudSynced = true;
            var fields = data["fields"];
            if (!(fields instanceof Lang.Dictionary)) {
                return;
            }

            var sessionActive = extractFsBool(fields, "sessionActive", true);
            var incomingSid = extractFsString(fields, "sessionId", "");

            if (!sessionActive) {
                if (arrowsCount > 0 || totalScore > 0 || stepsCount > 0 || distanceWalkedM > 0) {
                    resetAllCounters("");
                }
                WatchUi.requestUpdate();
                return;
            }

            if (incomingSid.length() > 0 && currentSessionId.length() > 0 && !incomingSid.equals(currentSessionId)) {
                resetAllCounters(incomingSid);
            } else if (incomingSid.length() > 0) {
                currentSessionId = incomingSid;
            }

            var recentlyTapped = (System.getTimer() - mLastLocalActionMs) < 3500;
            if (!recentlyTapped) {
                arrowsCount = extractFsInt(fields, "arrowsCount", arrowsCount);
                totalScore = extractFsInt(fields, "totalScore", totalScore);
                currentEnd = extractFsInt(fields, "currentEnd", currentEnd);

                if (fields.hasKey("currentEndArrows") && fields["currentEndArrows"] instanceof Lang.Dictionary) {
                    var arrNode = fields["currentEndArrows"];
                    if (arrNode.hasKey("arrayValue") && arrNode["arrayValue"] instanceof Lang.Dictionary) {
                        var av = arrNode["arrayValue"];
                        var parsedArr = [] as Lang.Array<Lang.String>;
                        if (av.hasKey("values") && av["values"] instanceof Lang.Array) {
                            var vals = av["values"];
                            for (var i = 0; i < vals.size(); i++) {
                                var item = vals[i];
                                if ((item instanceof Lang.Dictionary) && item.hasKey("stringValue") && item["stringValue"] != null) {
                                    parsedArr.add(item["stringValue"].toString());
                                }
                            }
                        }
                        currentEndArrows = parsedArr;
                    }
                }
            }

            distanceM = extractFsInt(fields, "distanceM", distanceM);
            arrowsPerEnd = extractFsInt(fields, "arrowsPerEnd", arrowsPerEnd);
            endsCount = extractFsInt(fields, "totalEnds", endsCount);
            bowPoundageLbs = extractFsInt(fields, "bowPoundageLbs", bowPoundageLbs);
            autoDetectEnabled = extractFsBool(fields, "autoDetectEnabled", autoDetectEnabled);
            sensitivityLevel = extractFsInt(fields, "sensitivityLevel", sensitivityLevel);

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
            if (isCloudSynced) {
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

        var isYellow = (statusLabel.find("CAMINANDO") != null) || (statusLabel.find("EDITAR") != null);
        var isMuted = (statusLabel.find("LOCAL") != null) || (statusLabel.find("SIN VINCULAR") != null);
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
        var ft = (distanceWalkedM * 3.28084).toNumber();
        var mtsFtStr = mts.toString() + " mts · " + ft.toString() + " ft";

        if (screenIdx == 0) {
            var sensTxt = (sensitivityLevel == 0) ? "BAJA" : ((sensitivityLevel == 2) ? "ALTA" : "MEDIA");
            var connSuffix = isConnectedNow ? " · SYNC" : "";
            var pillTxt = !autoDetectEnabled
                ? ("MANUAL" + connSuffix)
                : ((System.getTimer() < mWalkingLockUntilMs) ? "PAUSA · CAMINANDO" : ("AUTO · " + sensTxt + connSuffix));
            drawArchery101010Header(dc, w, h, s, pillTxt, false);

            var d3 = (arrowsCount / 1000) % 10;
            var d2 = (arrowsCount / 100) % 10;
            var d1 = (arrowsCount / 10) % 10;
            var d0 = arrowsCount % 10;
            var digits = [d3, d2, d1, d0] as Lang.Array<Lang.Number>;

            var boxW = (37.0 * s).toNumber();
            var boxH = (56.0 * s).toNumber();
            var gap = (5.0 * s).toNumber();
            var totalW = (boxW * 4) + (gap * 3);
            var startX = cx - (totalW / 2);
            var startY = (66.0 * s).toNumber();

            for (var i = 0; i < 4; i++) {
                var rx = startX + i * (boxW + gap);
                var cellFill = (i == 3) ? 0x121107 : 0x0B0E15;
                var cellBorder = (i == 3) ? 0xFFE500 : 0x3E4756;
                drawCrispBox(dc, rx, startY, boxW, boxH, (7.0 * s).toNumber(), cellFill, cellBorder, strokePx);

                dc.setColor((i == 3) ? 0xFFE500 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(rx + (boxW / 2), startY + (boxH / 2), fHero, digits[i].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Dedicated Tactile Row: [-1]  |  T1 · 18M  |  [+1]  (Zero collision with telemetry)
            var rowY = (131.0 * s).toNumber();
            var btnW = (42.0 * s).toNumber();
            var btnH = (28.0 * s).toNumber();
            var rowW = (162.0 * s).toNumber();

            var minusX = cx - (rowW / 2);
            drawCrispBox(dc, minusX, rowY, btnW, btnH, btnH / 2, 0x180709, 0xFF1E1E, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(minusX + (btnW / 2), rowY + (btnH / 2), fLabel, "-1", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var plusX = cx + (rowW / 2) - btnW;
            drawCrispBox(dc, plusX, rowY, btnW, btnH, btnH / 2, 0x061523, 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(plusX + (btnW / 2), rowY + (btnH / 2), fLabel, "+1", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var endDistLabel = "T" + currentEnd.toString() + " · " + distanceM.toString() + "M";
            dc.setColor(0xCBD5E1, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, rowY + (btnH / 2), fMicro, endDistLabel, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            // Dedicated Bottom Telemetry Line (100% separated vertically below buttons)
            var telemStr = mts.toString() + " mts · " + activeKcal.toString() + " kcal";
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (176.0 * s).toNumber(), fMicro, telemStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 1) {
            drawArchery101010Header(dc, w, h, s, "T" + currentEnd.toString() + "/" + endsCount.toString() + " · " + totalScore.toString() + " PTS", true);

            // Current End Arrow Slots (up to 6 compact cells)
            var slotCount = (arrowsPerEnd < 6) ? arrowsPerEnd : 6;
            if (slotCount < 1) { slotCount = 6; }
            var slotW = (22.0 * s).toNumber();
            var slotH = (15.0 * s).toNumber();
            var slotGap = (4.0 * s).toNumber();
            var slotsTotalW = (slotCount * slotW) + ((slotCount - 1) * slotGap);
            var slotsStartX = cx - (slotsTotalW / 2);
            var slotsY = (56.0 * s).toNumber();

            for (var si = 0; si < slotCount; si++) {
                var sx = slotsStartX + si * (slotW + slotGap);
                var hasVal = (si < currentEndArrows.size());
                var sVal = hasVal ? currentEndArrows[si] : "-";
                drawCrispBox(dc, sx, slotsY, slotW, slotH, (4.0 * s).toNumber(), 0x07090E, hasVal ? 0xFFE500 : 0x334155, 1);
                dc.setColor(hasVal ? Graphics.COLOR_WHITE : 0x64748B, Graphics.COLOR_TRANSPARENT);
                dc.drawText(sx + (slotW / 2), slotsY + (slotH / 2), fMicro, sVal, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // 12 Tactile Score Keys (4x3: X, 10..1, M) mathematically contained inside circular bezel
            var padW = (164.0 * s).toNumber();
            var kGap = (4.0 * s).toNumber();
            var keyW = (padW - (3 * kGap)) / 4;
            var keyH = (22.0 * s).toNumber();
            var kStartX = cx - (padW / 2);
            var kStartY = (76.0 * s).toNumber();

            for (var k = 0; k < 12; k++) {
                var r = k / 4;
                var c = k % 4;
                var kx = kStartX + c * (keyW + kGap);
                var ky = kStartY + r * (keyH + kGap);
                var isSel = (k == selectedScoreIdx);

                var bgCol = (k < 3) ? 0x121107 : ((k < 5) ? 0x160708 : ((k < 7) ? 0x061320 : 0x0B0E15));
                var borderCol = isSel ? 0xFFFFFF : ((k < 3) ? 0xFFE500 : ((k < 5) ? 0xFF1E1E : ((k < 7) ? 0x00A8F3 : 0x475569)));
                var txtCol = (k < 3) ? 0xFFE500 : ((k == 11) ? 0xCBD5E1 : Graphics.COLOR_WHITE);

                drawCrispBox(dc, kx, ky, keyW, keyH, (5.0 * s).toNumber(), bgCol, borderCol, strokePx);
                dc.setColor(txtCol, Graphics.COLOR_TRANSPARENT);
                dc.drawText(kx + (keyW / 2), ky + (keyH / 2), fLabel, scoreLabels[k], Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Bottom Actions: [ BORRAR ]   [ SIG. TANDA ]  with clear separation & full containment
            var actGap = (7.0 * s).toNumber();
            var actWTotal = (165.0 * s).toNumber();
            var actStartX = cx - (actWTotal / 2);
            var actY = (156.0 * s).toNumber();
            var actW = (actWTotal - actGap) / 2;
            var actH = (23.0 * s).toNumber();

            drawCrispBox(dc, actStartX, actY, actW, actH, actH / 2, 0x0B0E15, 0x475569, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(actStartX + (actW / 2), actY + (actH / 2), fMicro, "BORRAR", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var nextX = actStartX + actW + actGap;
            drawCrispBox(dc, nextX, actY, actW, actH, actH / 2, 0x061523, 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(nextX + (actW / 2), actY + (actH / 2), fMicro, "SIG. TANDA", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 2) {
            drawArchery101010Header(dc, w, h, s, "MÉTRICAS EN VIVO", false);

            var cardW = (164.0 * s).toNumber();
            var cardH = (44.0 * s).toNumber();
            var cardX = cx - (cardW / 2);
            var card1Y = (68.0 * s).toNumber();
            var card2Y = (119.0 * s).toNumber();
            var innerMaxW = cardW - (14.0 * s).toNumber();

            drawCrispBox(dc, cardX, card1Y, cardW, cardH, (9.0 * s).toNumber(), 0x07090E, 0x00A8F3, strokePx);
            dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card1Y + (13.0 * s).toNumber(), fMicro, "DISTANCIA · " + stepsCount.toString() + " PASOS", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            var distFont = pickFittingFont(dc, mtsFtStr, innerMaxW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card1Y + (30.0 * s).toNumber(), distFont, mtsFtStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            drawCrispBox(dc, cardX, card2Y, cardW, cardH, (9.0 * s).toNumber(), 0x07090E, 0xFF1E1E, strokePx);
            dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card2Y + (13.0 * s).toNumber(), fMicro, "GASTO ENERGÉTICO", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            var kcalStr = activeKcal.toString() + " kcal";
            var kcalFont = pickFittingFont(dc, kcalStr, innerMaxW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card2Y + (30.0 * s).toNumber(), kcalFont, kcalStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (177.0 * s).toNumber(), fMicro, arrowsCount.toString() + " FL · " + bowPoundageLbs.toString() + " LBS", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 3) {
            var sumStatus = isConnectedNow ? "CONECTADO · NUBE" : "MODO LOCAL";
            drawArchery101010Header(dc, w, h, s, sumStatus, false);

            var sumW = (164.0 * s).toNumber();
            var sumX = cx - (sumW / 2);
            var sumY = (70.0 * s).toNumber();
            var sumH = (72.0 * s).toNumber();
            var sumInnerW = sumW - (14.0 * s).toNumber();

            drawCrispBox(dc, sumX, sumY, sumW, sumH, (10.0 * s).toNumber(), 0x07090E, isConnectedNow ? 0x00A8F3 : 0xFFE500, strokePx);

            var line1 = arrowsCount.toString() + " FL · " + totalScore.toString() + " PTS";
            var line1Font = pickFittingFont(dc, line1, sumInnerW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, sumY + (22.0 * s).toNumber(), line1Font, line1, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            dc.setColor(0x1E293B, Graphics.COLOR_TRANSPARENT);
            dc.drawLine(sumX + (12.0 * s).toNumber(), sumY + (39.0 * s).toNumber(), sumX + sumW - (12.0 * s).toNumber(), sumY + (39.0 * s).toNumber());

            var line2 = mts.toString() + " mts · " + activeKcal.toString() + " kcal";
            var line2Font = pickFittingFont(dc, line2, sumInnerW, fLabel, fMicro, fMicro);
            dc.setColor(0xFFE500, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, sumY + (55.0 * s).toNumber(), line2Font, line2, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var ctaW = (150.0 * s).toNumber();
            var ctaH = (26.0 * s).toNumber();
            var ctaX = cx - (ctaW / 2);
            var ctaY = (152.0 * s).toNumber();
            drawCrispBox(dc, ctaX, ctaY, ctaW, ctaH, ctaH / 2, 0x061523, 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, ctaY + (ctaH / 2), fMicro, "FINALIZAR SESIÓN", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else {
            // SCREEN 4: 6-DIGIT CLOUD PAIRING CODE PICKER
            var pairHeader = isEditingCode
                ? ("EDITAR DÍGITO " + (editDigitPos + 1).toString() + "/6")
                : (isCloudSynced ? "NUBE CONECTADA" : (hasPairingCode ? "CÓDIGO GUARDADO" : "SIN VINCULAR"));
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

            // Touch & Button Row: [-] | [DÍGITO >] | [+]
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
            drawCrispBox(dc, midX, ctrlY, midW, ctrlH, ctrlH / 2, 0x0B0E15, 0x475569, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(midX + (midW / 2), ctrlY + (ctrlH / 2), fMicro, "DÍGITO >", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var plusBtnX = midX + midW + btnGap;
            drawCrispBox(dc, plusBtnX, ctrlY, smallW, ctrlH, ctrlH / 2, 0x061523, 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(plusBtnX + (smallW / 2), ctrlY + (ctrlH / 2), fLabel, "+", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            // Save & Sync CTA
            var saveW = (146.0 * s).toNumber();
            var saveH = (25.0 * s).toNumber();
            var saveX = cx - (saveW / 2);
            var saveY = (149.0 * s).toNumber();
            drawCrispBox(dc, saveX, saveY, saveW, saveH, saveH / 2, 0x061523, isCloudSynced ? 0xFFE500 : 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, saveY + (saveH / 2), fMicro, isCloudSynced ? "SINCRONIZAR" : "VINCULAR CÓDIGO", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
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
            mView.syncWithPhoneApp("SYNC_TELEMETRY_FROM_WATCH", null);
        } else if (mView.screenIdx == 3) {
            mView.finishSessionAndReset();
        } else if (mView.screenIdx == 4) {
            if (!mView.isEditingCode) {
                mView.isEditingCode = true;
                mView.editDigitPos = 0;
                WatchUi.requestUpdate();
            } else if (mView.editDigitPos < 5) {
                mView.editDigitPos = mView.editDigitPos + 1;
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
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() {
        if (mView.screenIdx == 4 && mView.isEditingCode) {
            mView.adjustSelectedCodeDigit(1);
            return true;
        }
        mView.screenIdx = (mView.screenIdx + 4) % 5;
        WatchUi.requestUpdate();
        return true;
    }

    function onMenu() {
        if (mView.screenIdx == 1) {
            mView.advanceNextEnd();
            return true;
        }
        mView.cycleSensitivityMode();
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
            WatchUi.requestUpdate();
            return true;
        }

        // Top pill tap on Screen 0 cycles sensitivity
        if (mView.screenIdx == 0 && ty <= (62.0 * s)) {
            mView.cycleSensitivityMode();
            return true;
        }

        if (mView.screenIdx == 0) {
            // Deliberate -1 / +1 buttons ONLY (prevents accidental wrist/sleeve/arrow touches on 0000 chassis)
            if (ty >= (126.0 * s) && ty <= (165.0 * s)) {
                if (tx < (cx - (34.0 * s))) {
                    if (mView.arrowsCount > 0) {
                        mView.incrementArrow(-1, false);
                    }
                    return true;
                } else if (tx > (cx + (34.0 * s))) {
                    mView.incrementArrow(1, false);
                    return true;
                }
            }
        } else if (mView.screenIdx == 1) {
            var padW = 164.0 * s;
            var kGap = 4.0 * s;
            var keyW = (padW - (3.0 * kGap)) / 4.0;
            var keyH = 22.0 * s;
            var kStartX = cx - (padW / 2.0);
            var kStartY = 75.0 * s;

            for (var k = 0; k < 12; k++) {
                var r = k / 4;
                var c = k % 4;
                var kx = kStartX + c * (keyW + kGap);
                var ky = kStartY + r * (keyH + kGap);
                if (tx >= kx && tx <= (kx + keyW) && ty >= ky && ty <= (ky + keyH)) {
                    mView.selectedScoreIdx = k;
                    mView.recordScoreInput(mView.scoreLabels[k]);
                    return true;
                }
            }

            // Bottom BORRAR | SIG. TANDA touch buttons
            if (ty >= (152.0 * s) && ty <= (184.0 * s)) {
                if (tx < cx) {
                    mView.undoLastScore();
                } else {
                    mView.advanceNextEnd();
                }
                return true;
            }
        } else if (mView.screenIdx == 2) {
            mView.syncWithPhoneApp("SYNC_TELEMETRY_FROM_WATCH", null);
            return true;
        } else if (mView.screenIdx == 3) {
            if (ty >= (148.0 * s) && ty <= (186.0 * s)) {
                mView.finishSessionAndReset();
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
                        if (mView.editDigitPos == di) {
                            mView.adjustSelectedCodeDigit(1);
                        } else {
                            mView.editDigitPos = di;
                            WatchUi.requestUpdate();
                        }
                        return true;
                    }
                }
            }

            // [-] | [DÍGITO >] | [+] row
            if (ty >= (113.0 * s) && ty <= (144.0 * s)) {
                if (tx < (cx - (34.0 * s))) {
                    mView.adjustSelectedCodeDigit(-1);
                } else if (tx > (cx + (34.0 * s))) {
                    mView.adjustSelectedCodeDigit(1);
                } else {
                    mView.editDigitPos = (mView.editDigitPos + 1) % 6;
                    WatchUi.requestUpdate();
                }
                return true;
            }

            // VINCULAR CÓDIGO button
            if (ty >= (146.0 * s) && ty <= (182.0 * s)) {
                mView.commitPairingDigits();
                return true;
            }
        }
        return false;
    }

    function onBack() {
        if (mView.screenIdx == 4 && mView.isEditingCode) {
            mView.isEditingCode = false;
            WatchUi.requestUpdate();
            return true;
        }
        if (mView.screenIdx == 0 && mView.arrowsCount > 0) {
            mView.incrementArrow(-1, false);
            return true;
        } else if (mView.screenIdx == 1) {
            mView.selectedScoreIdx = (mView.selectedScoreIdx + 1) % 12;
            WatchUi.requestUpdate();
            return true;
        }
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
