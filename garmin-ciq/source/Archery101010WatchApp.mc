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
 * ARCHERY 101010 — Connect IQ Watch App
 * 5 Screens synchronized in real time via 256-bit Cloud Session Token + Phone Bridge:
 *  - Screen 0: 4-Digit Counter (0 0 0 0) / Biomechanical Shot Analysis + Walked & Kcal
 *  - Screen 1: Full Scorepad (X, 10..1, M) + End Arrow Slots + BORRAR / SIG. TANDA (Touch + 5-Button Cursor)
 *  - Screen 2: Biometrics (Pedometer · Steps, Distance + Kcal + Optical HR)
 *  - Screen 3: Session Summary + 2-Step Confirmed Save & Reset
 *  - Screen 4: 6-Digit Ephemeral Cloud Pairing Handshake -> 256-bit Session Token
 */
class Archery101010WatchApp extends Application.AppBase {
    hidden var mView as Archery101010WatchView?;
    hidden var mPhoneMsgCallback as Lang.Method?;
    public var mGpsEnabled as Lang.Boolean = false;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) as Void {
        if (Sensor has :setEnabledSensors) {
            try {
                Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE] as Lang.Array<Sensor.SensorType>);
            } catch (ex) {}
        }
        if (Communications has :registerForPhoneAppMessages) {
            try {
                var cb = method(:onPhoneMessage);
                mPhoneMsgCallback = cb;
                Communications.registerForPhoneAppMessages(cb);
            } catch (ex) {}
        }
    }

    function setGpsLocationActive(enable as Lang.Boolean) as Void {
        if (enable && !mGpsEnabled) {
            try {
                Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
                mGpsEnabled = true;
            } catch (ex) {
                mGpsEnabled = false;
            }
        } else if (!enable && mGpsEnabled) {
            try {
                Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
            } catch (ex) {}
            mGpsEnabled = false;
        }
    }

    function onStop(state) as Void {
        setGpsLocationActive(false);
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
        var view = mView;
        if (view != null) {
            view.onAppStop();
        }
    }

    function onPosition(info as Position.Info) as Void {
        var view = mView;
        if (view != null) {
            view.updateGpsPosition(info);
        }
    }

    function onPhoneMessage(msg as Communications.PhoneAppMessage) as Void {
        var view = mView;
        if (view != null && msg != null && msg.data != null) {
            view.handleIncomingPhoneData(msg.data);
        }
    }

    function getInitialView() {
        var view = new Archery101010WatchView(self);
        mView = view;
        var delegate = new Archery101010WatchDelegate(view);
        return [ view, delegate ];
    }
}

class Archery101010WatchView extends WatchUi.View {
    private var mApp as Archery101010WatchApp;

    public var screenIdx as Lang.Number = 0; // 0: Counter, 1: Scorepad, 2: Biometrics, 3: Summary, 4: Cloud Link
    public var arrowsCount as Lang.Number = 0;
    public var totalScore as Lang.Number = 0;
    public var roundScoreMax as Lang.Number = 0;
    public var currentEnd as Lang.Number = 1;
    public var endsCount as Lang.Number = 12;
    public var arrowsPerEnd as Lang.Number = 6;
    public var distanceM as Lang.Number = 18;
    public var bowPoundageLbs as Lang.Number = 38;
    public var stepsCount as Lang.Number = 0;
    public var gpsDistanceM as Lang.Float = 0.0;
    public var distanceWalkedM as Lang.Number = 0;
    public var activeKcal as Lang.Number = 0;
    public var heartRateBpm as Lang.Number = 0;
    public var avgHeartRateBpm as Lang.Number = 0;
    public var maxHeartRateBpm as Lang.Number = 0;
    public var analysisMode as Lang.Boolean = false;
    public var autoDetectEnabled as Lang.Boolean = false;
    public var manualAnalysisRecording as Lang.Boolean = false;
    public var manualAnalysisStartTimerMs as Lang.Number = 0;
    public var lastAnalysisStabPct as Lang.Number = 0;
    public var bowTypeStr as Lang.String = "Barebow";
    public var bowWristStr as Lang.String = "LEFT";
    public var sensitivityLevel as Lang.Number = 1;
    public var selectedScoreIdx as Lang.Number = 0; // 0..11 keys, 12 BORRAR, 13 SIG. TANDA
    public var isPadCursorActive as Lang.Boolean = false;
    public var scoreLabels as Lang.Array<Lang.String> = ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"];
    public var currentEndArrows as Lang.Array<Lang.String> = [] as Lang.Array<Lang.String>;
    public var currentSessionId as Lang.String = "";

    // Locale, Regional Units & Hardware Capability state
    public var isSpanish as Lang.Boolean = false;
    public var isImperial as Lang.Boolean = false;
    public var isTouchScreen as Lang.Boolean = true;
    public var isLowRamDevice as Lang.Boolean = false;
    public var lastSavedFeedbackMs as Lang.Number = 0;

    // 2-Step Confirmation & Safety Guards (AUD-GAR-02, AUD-GAR-08)
    public var mConfirmFinishUntilMs as Lang.Number = 0;
    public var mConfirmResetUntilMs as Lang.Number = 0;
    public var mFinishWarnUntilMs as Lang.Number = 0;
    public var mConfirmExitUntilMs as Lang.Number = 0;

    // 6-Digit Pairing -> 256-Bit Session Token Handshake state (AUD-FB-01, AUD-GAR-05)
    public var pairingDigits as Lang.Array<Lang.Number> = [1, 0, 1, 0, 1, 0];
    public var hasPairingCode as Lang.Boolean = false;
    public var pairingCode as Lang.String = "";
    public var mCodeEditedByUser as Lang.Boolean = false;
    public var isEditingCode as Lang.Boolean = false;
    public var editDigitPos as Lang.Number = 0;
    public var mCloudSessionToken as Lang.String = "";
    public var mWatchDeviceId as Lang.String = "";
    public var mCloudErrorState as Lang.String = ""; // "", "NO_BLE", "EXPIRED", "INVALID"
    public var mHandshakeBlockedCode as Lang.String = "";
    public var mHandshakeInFlight as Lang.Boolean = false;
    public var mHandshakeStartMs as Lang.Number = 0;
    public var mPendingClaimToken as Lang.String = "";
    public var isCloudSynced as Lang.Boolean = false;
    public var mCloudSyncOk as Lang.Boolean = false;
    public var isBleConnected as Lang.Boolean = false;
    public var mRemoteGpsActive as Lang.Boolean = false;

    // Persistent Multi-Slot FIFO Offline Command Queue (AUD-GAR-01, max 24 entries)
    hidden const MAX_CMD_QUEUE_SIZE = 24;
    public var mPendingCmdQueue as Lang.Array<Lang.Dictionary> = [] as Lang.Array<Lang.Dictionary>;
    hidden var mCmdSeq as Lang.Number = 0;
    hidden var mPatchInFlight as Lang.Boolean = false;
    hidden var mPatchInFlightMs as Lang.Number = 0;
    hidden var mInFlightCmdId as Lang.String = "";
    hidden var mLatestEnqueuedCmdId as Lang.String = "";
    hidden var mAwaitingPhoneSync as Lang.Boolean = false;

    // GPS & Pedometer tracking state
    hidden var mStartElapsedDistM as Lang.Float? = null;
    hidden var mLastLat as Lang.Double? = null;
    hidden var mLastLon as Lang.Double? = null;
    hidden var mBaselineSteps as Lang.Number? = null;
    hidden var mLastObservedSteps as Lang.Number? = null;
    hidden var mHighFreqAccelActive as Lang.Boolean = false;
    hidden var mHasHardwareGyro as Lang.Boolean = false;

    // Scaled Analysis IMU Ring Buffer (180 samples on <=135KB low-RAM watches; 240 samples + 6-axis gyro on high-RAM watches)
    hidden var mAnaSize as Lang.Number = 180;
    hidden var mAnaT as Lang.Array<Lang.Number>? = null;
    hidden var mAnaAx as Lang.Array<Lang.Float>? = null;
    hidden var mAnaAy as Lang.Array<Lang.Float>? = null;
    hidden var mAnaAz as Lang.Array<Lang.Float>? = null;
    hidden var mAnaPeak as Lang.Array<Lang.Float>? = null;
    hidden var mAnaGy as Lang.Array<Lang.Float>? = null;
    hidden var mAnaGz as Lang.Array<Lang.Float>? = null;
    hidden var mAnaIdx as Lang.Number = 0;
    hidden var mAnaCount as Lang.Number = 0;
    hidden var mLastAnaSampleMs as Lang.Number = 0;
    hidden var mLastSampleAx as Lang.Float = 0.0;
    hidden var mLastSampleAy as Lang.Float = 0.0;
    hidden var mLastSampleAz as Lang.Float = -1000.0;
    hidden var mPrevRawMagMg as Lang.Float = 1000.0;
    hidden var mBoxSumAx as Lang.Float = 0.0;
    hidden var mBoxSumAy as Lang.Float = 0.0;
    hidden var mBoxSumAz as Lang.Float = 0.0;
    hidden var mBoxSumGy as Lang.Float = 0.0;
    hidden var mBoxSumGz as Lang.Float = 0.0;
    hidden var mBoxCnt as Lang.Number = 0;
    hidden var mBoxPeakJerkMg as Lang.Float = 0.0;
    hidden var mAutoQuietMs as Lang.Number = 0;
    hidden var mAutoPendingMs as Lang.Number = 0;
    hidden var mAutoFollowLinSum as Lang.Float = 0.0;
    hidden var mAutoFollowAxSum as Lang.Float = 0.0;
    hidden var mAutoFollowCnt as Lang.Number = 0;
    hidden var mLastAutoShotMs as Lang.Number = 0;
    hidden var mLastStepTickMs as Lang.Number = 0;
    hidden var mCalZeroVec as Lang.Array<Lang.Number>? = null;
    hidden var mLastCalibrateZeroTs as Lang.Long = 0l;
    hidden var mLastRemoteStartTs as Lang.Long = 0l;
    hidden var mLastRemoteStopTs as Lang.Long = 0l;

    // Adaptive Polling & Optical HR state
    hidden var mLastLocalActionMs as Lang.Number = 0;
    hidden var mLastActivityMs as Lang.Number = 0;
    hidden var mLastCloudPollMs as Lang.Number = 0;
    hidden var mLastRemoteStateSig as Lang.String = "";
    hidden var mLastBleStateSig as Lang.String = "";
    hidden var mLastTelemetryPushSteps as Lang.Number = 0;
    hidden var mHrSum as Lang.Number = 0;
    hidden var mHrSamples as Lang.Number = 0;
    hidden var mLastHrSampleMs as Lang.Number = 0;
    hidden var mLastHrPushMs as Lang.Number = 0;
    hidden var mSensorTimer as Timer.Timer? = null;

    // BrandLogo & Outfit Athletic Fonts
    hidden var mBrandLogo as WatchUi.BitmapResource? = null;
    hidden var mFontMicro as Graphics.FontType? = null;
    hidden var mFontLabel as Graphics.FontType? = null;
    hidden var mFontValue as Graphics.FontType? = null;
    hidden var mFontHero as Graphics.FontType? = null;

    // Cached layout hit-boxes for touch targets
    public var lastScreenWidth as Lang.Number = 240;
    public var lastScreenHeight as Lang.Number = 240;
    public var lastPadStartX as Lang.Number = 25;
    public var lastPadStartY as Lang.Number = 55;
    public var lastKeyW as Lang.Number = 44;
    public var lastKeyH as Lang.Number = 37;
    public var lastKeyGap as Lang.Number = 4;
    public var lastActY as Lang.Number = 180;
    public var lastActH as Lang.Number = 26;
    public var lastCtaY as Lang.Number = 152;
    public var lastCtaH as Lang.Number = 26;
    public var lastDigitStartX as Lang.Number = 30;
    public var lastDigitStartY as Lang.Number = 69;
    public var lastDigitW as Lang.Number = 23;
    public var lastDigitH as Lang.Number = 38;
    public var lastDigitGap as Lang.Number = 4;
    public var lastPairCtrlY as Lang.Number = 116;
    public var lastPairCtrlH as Lang.Number = 25;
    public var lastPairSaveY as Lang.Number = 149;
    public var lastPairSaveH as Lang.Number = 25;

    function initialize(app as Archery101010WatchApp) {
        View.initialize();
        mApp = app;
        var initNow = System.getTimer();
        mLastActivityMs = initNow;
        mLastCloudPollMs = initNow;
        detectHardwareAndMemoryProfile();
        refreshDeviceLocaleAndUnits();
        loadBrandResources();
        loadStateFromStorage();
        ensureWatchDeviceId();
        initStepBaseline();
        syncHighFreqAccelerometer();
        syncGpsTrackingState();
        ensureSensorTimerRunning();

        if (hasPairingCode && isValidPairingCode(pairingCode)) {
            pollFirestoreCloud();
        }
    }

    function detectHardwareAndMemoryProfile() as Void {
        try {
            var stats = System.getSystemStats();
            if (stats != null && (stats has :totalMemory) && stats.totalMemory != null) {
                isLowRamDevice = (stats.totalMemory <= 135000);
            }
        } catch (ex) {}
        mAnaSize = isLowRamDevice ? 180 : 240;
    }

    function ensureAnalysisBuffersAllocated() as Void {
        if (mAnaT == null) {
            mAnaT = new [mAnaSize] as Lang.Array<Lang.Number>;
            mAnaAx = new [mAnaSize] as Lang.Array<Lang.Float>;
            mAnaAy = new [mAnaSize] as Lang.Array<Lang.Float>;
            mAnaAz = new [mAnaSize] as Lang.Array<Lang.Float>;
            mAnaPeak = new [mAnaSize] as Lang.Array<Lang.Float>;
            if (!isLowRamDevice) {
                mAnaGy = new [mAnaSize] as Lang.Array<Lang.Float>;
                mAnaGz = new [mAnaSize] as Lang.Array<Lang.Float>;
            }
            mAnaIdx = 0;
            mAnaCount = 0;
        }
    }

    function releaseAnalysisBuffersIfLowRam() as Void {
        if (isLowRamDevice && !analysisMode) {
            mAnaT = null;
            mAnaAx = null;
            mAnaAy = null;
            mAnaAz = null;
            mAnaPeak = null;
            mAnaGy = null;
            mAnaGz = null;
            mAnaIdx = 0;
            mAnaCount = 0;
        }
    }

    function ensureSensorTimerRunning() as Void {
        if (mSensorTimer == null) {
            var t = new Timer.Timer();
            t.start(method(:onSensorTick), 100, true);
            mSensorTimer = t;
        }
    }

    function onAppStop() as Void {
        var t = mSensorTimer;
        if (t != null) {
            try {
                t.stop();
            } catch (ex) {}
            mSensorTimer = null;
        }
        unregisterHighFreqAccelerometer();
        saveStateToStorage();
    }

    function onShow() as Void {
        refreshDeviceLocaleAndUnits();
        ensureSensorTimerRunning();
        syncGpsTrackingState();
        markUserActivity(false);
    }

    function syncGpsTrackingState() as Void {
        var outdoorActive = mRemoteGpsActive || (distanceM >= 30 && (arrowsCount > 0 || currentSessionId.length() > 0));
        mApp.setGpsLocationActive(outdoorActive);
    }

    function getAdaptiveCloudPollIntervalMs(now as Lang.Number) as Lang.Number {
        if (now < mLastActivityMs) {
            mLastActivityMs = now;
        }
        if (analysisMode) {
            return 3000;
        }
        var idleMs = now - mLastActivityMs;
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
        if (!isWriteAction && hasPairingCode && isValidPairingCode(pairingCode) && !isEditingCode) {
            if (mHandshakeBlockedCode.length() > 0 && mHandshakeBlockedCode.equals(pairingCode)) {
                return;
            }
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
                if (devSettings has :isTouchScreen) {
                    isTouchScreen = (devSettings.isTouchScreen == true);
                }
            }
        } catch (ex) {}
    }

    (:typecheck(false))
    function ensureWatchDeviceId() as Void {
        if (mWatchDeviceId.length() >= 4 && mWatchDeviceId.length() <= 80) {
            return;
        }
        var uid = "";
        try {
            var devSettings = System.getDeviceSettings();
            if (devSettings != null && (devSettings has :uniqueIdentifier) && devSettings.uniqueIdentifier != null) {
                uid = devSettings.uniqueIdentifier.toString();
            }
        } catch (ex) {}
        if (uid.length() > 64) {
            uid = uid.substring(0, 64);
        }
        if (uid.length() > 0) {
            mWatchDeviceId = "GARMIN-" + uid;
        } else {
            mWatchDeviceId = "GARMIN-" + Time.now().value().toString() + "-" + (System.getTimer() % 10000).toString();
        }
        if (Application has :Storage) {
            try {
                Application.Storage.setValue("watchDeviceId", mWatchDeviceId);
            } catch (ex) {}
        }
    }

    function isValidPairingCode(code as Lang.String) as Lang.Boolean {
        if (code.length() != 6) {
            return false;
        }
        var chars = code.toCharArray();
        for (var i = 0; i < 6; i++) {
            var n = chars[i].toNumber();
            if (n < 48 || n > 57) {
                return false;
            }
        }
        return true;
    }

    function isValidSessionToken(tok as Lang.String) as Lang.Boolean {
        var len = tok.length();
        if (len < 32 || len > 64) {
            return false;
        }
        var chars = tok.toCharArray();
        for (var i = 0; i < len; i++) {
            var c = chars[i].toNumber();
            var ok = (c >= 48 && c <= 57)
                || (c >= 65 && c <= 90)
                || (c >= 97 && c <= 122)
                || (c == 95)
                || (c == 45);
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    function tr(esStr as Lang.String, enStr as Lang.String) as Lang.String {
        return isSpanish ? esStr : enStr;
    }

    function clampInt(val as Lang.Number, minV as Lang.Number, maxV as Lang.Number) as Lang.Number {
        if (val < minV) { return minV; }
        if (val > maxV) { return maxV; }
        return val;
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
            if (monInfo != null && (monInfo has :steps)) {
                var rawSteps = monInfo.steps;
                if (rawSteps != null) {
                    mLastObservedSteps = rawSteps;
                    if (stepsCount > 0 && rawSteps >= stepsCount) {
                        mBaselineSteps = rawSteps - stepsCount;
                    } else {
                        mBaselineSteps = rawSteps;
                    }
                }
            }
        }
    }

    (:typecheck(false))
    function registerHighFreqAccelerometer() as Void {
        ensureAnalysisBuffersAllocated();
        if (mHighFreqAccelActive) {
            return;
        }
        if (Sensor has :registerSensorDataListener) {
            var sampleHz = isLowRamDevice ? 15 : 25;
            if (!isLowRamDevice) {
                try {
                    var optsGyro = {
                        :period => 1,
                        :accelerometer => {
                            :enabled => true,
                            :sampleRate => sampleHz
                        },
                        :gyroscope => {
                            :enabled => true,
                            :sampleRate => sampleHz
                        }
                    };
                    Sensor.registerSensorDataListener(method(:onAccelBatch), optsGyro);
                    mHighFreqAccelActive = true;
                    mHasHardwareGyro = true;
                    return;
                } catch (exGyro) {
                    mHasHardwareGyro = false;
                }
            }
            try {
                var opts = {
                    :period => 1,
                    :accelerometer => {
                        :enabled => true,
                        :sampleRate => sampleHz
                    }
                };
                Sensor.registerSensorDataListener(method(:onAccelBatch), opts);
                mHighFreqAccelActive = true;
                mHasHardwareGyro = false;
            } catch (ex) {
                mHighFreqAccelActive = false;
                mHasHardwareGyro = false;
            }
        }
    }

    (:typecheck(false))
    function unregisterHighFreqAccelerometer() as Void {
        if (mHighFreqAccelActive && (Sensor has :unregisterSensorDataListener)) {
            try {
                Sensor.unregisterSensorDataListener();
            } catch (ex) {}
        }
        mHighFreqAccelActive = false;
        releaseAnalysisBuffersIfLowRam();
    }

    function syncHighFreqAccelerometer() as Void {
        if (analysisMode) {
            registerHighFreqAccelerometer();
        } else {
            unregisterHighFreqAccelerometer();
        }
    }

    (:typecheck(false))
    function loadStateFromStorage() as Void {
        if (!(Application has :Storage)) {
            return;
        }
        try {
            var savedDevId = Application.Storage.getValue("watchDeviceId");
            if (savedDevId != null && savedDevId instanceof Lang.String && savedDevId.length() >= 4 && savedDevId.length() <= 80) {
                mWatchDeviceId = savedDevId;
            }
            var savedCode = Application.Storage.getValue("pairingCode");
            if (savedCode != null && savedCode instanceof Lang.String && isValidPairingCode(savedCode)) {
                pairingCode = savedCode;
                hasPairingCode = true;
                mCodeEditedByUser = true;
                parsePairingDigitsFromString(savedCode);
            }
            var savedTok = Application.Storage.getValue("cloudSessionToken");
            if (savedTok != null && savedTok instanceof Lang.String && isValidSessionToken(savedTok)) {
                mCloudSessionToken = savedTok;
            }
            var savedSeq = Application.Storage.getValue("cmdSeq");
            if (savedSeq != null && savedSeq instanceof Lang.Number && savedSeq >= 0) {
                mCmdSeq = savedSeq;
            }
            var savedLastId = Application.Storage.getValue("latestEnqueuedCmdId");
            if (savedLastId != null && savedLastId instanceof Lang.String) {
                mLatestEnqueuedCmdId = savedLastId;
            }
            var savedAwait = Application.Storage.getValue("awaitingPhoneSync");
            if (savedAwait != null && savedAwait instanceof Lang.Boolean) {
                mAwaitingPhoneSync = savedAwait;
            }
            var savedQueue = Application.Storage.getValue("pendingCmdQueue");
            if (savedQueue != null && savedQueue instanceof Lang.Array) {
                var restoredQ = [] as Lang.Array<Lang.Dictionary>;
                for (var qi = 0; qi < savedQueue.size() && restoredQ.size() < MAX_CMD_QUEUE_SIZE; qi++) {
                    var qItem = savedQueue[qi];
                    if (qItem != null && qItem instanceof Lang.Dictionary && qItem.hasKey("id") && qItem.hasKey("t")) {
                        restoredQ.add(qItem as Lang.Dictionary);
                    }
                }
                mPendingCmdQueue = restoredQ;
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
            var dm = Application.Storage.getValue("distanceM");
            if (dm != null && dm instanceof Lang.Number && dm > 0) { distanceM = dm; }
            var sc = Application.Storage.getValue("stepsCount");
            if (sc != null && sc instanceof Lang.Number && sc >= 0) { stepsCount = sc; }
            var dw = Application.Storage.getValue("distanceWalkedM");
            if (dw != null && dw instanceof Lang.Number && dw >= 0) { distanceWalkedM = dw; }
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

    (:typecheck(false))
    function saveQueueToStorage() as Void {
        if (!(Application has :Storage)) {
            return;
        }
        try {
            Application.Storage.setValue("pendingCmdQueue", mPendingCmdQueue);
            Application.Storage.setValue("cmdSeq", mCmdSeq);
            Application.Storage.setValue("latestEnqueuedCmdId", mLatestEnqueuedCmdId);
            Application.Storage.setValue("awaitingPhoneSync", mAwaitingPhoneSync);
        } catch (ex) {}
    }

    (:typecheck(false))
    function saveStateToStorage() as Void {
        if (!(Application has :Storage)) {
            return;
        }
        try {
            if (hasPairingCode && isValidPairingCode(pairingCode)) {
                Application.Storage.setValue("pairingCode", pairingCode);
            }
            Application.Storage.setValue("cloudSessionToken", mCloudSessionToken);
            if (mWatchDeviceId.length() > 0) {
                Application.Storage.setValue("watchDeviceId", mWatchDeviceId);
            }
            Application.Storage.setValue("currentSessionId", currentSessionId);
            Application.Storage.setValue("arrowsCount", arrowsCount);
            Application.Storage.setValue("totalScore", totalScore);
            Application.Storage.setValue("currentEnd", currentEnd);
            Application.Storage.setValue("distanceM", distanceM);
            Application.Storage.setValue("stepsCount", stepsCount);
            Application.Storage.setValue("distanceWalkedM", distanceWalkedM);
            Application.Storage.setValue("sensitivityLevel", sensitivityLevel);
            Application.Storage.setValue("currentEndArrows", currentEndArrows);
            saveQueueToStorage();
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
        // Always reset sessionToken when pairingCode changes or when re-claiming an unlinked/expired code
        var codeChanged = !built.equals(pairingCode);
        pairingCode = built;
        hasPairingCode = true;
        mCodeEditedByUser = true;
        isEditingCode = false;
        if (codeChanged || !isValidSessionToken(mCloudSessionToken) || mCloudErrorState.equals("EXPIRED") || mCloudErrorState.equals("INVALID")) {
            mCloudSessionToken = "";
            isCloudSynced = false;
            mCloudSyncOk = false;
        }
        mCloudErrorState = "";
        mHandshakeBlockedCode = "";
        mHandshakeInFlight = false;
        mPendingClaimToken = "";
        mPatchInFlight = false;
        mInFlightCmdId = "";
        mLastRemoteStateSig = "";
        var now = System.getTimer();
        mLastActivityMs = now;
        mLastCloudPollMs = now;
        saveStateToStorage();
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(70, 60)]);
        }
        pollFirestoreCloud();
        WatchUi.requestUpdate();
    }

    function adjustSelectedCodeDigit(delta as Lang.Number) as Void {
        markUserActivity(true);
        mCodeEditedByUser = true;
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
        roundScoreMax = 0;
        currentEnd = 1;
        currentEndArrows = [] as Lang.Array<Lang.String>;
        stepsCount = 0;
        mLastTelemetryPushSteps = 0;
        gpsDistanceM = 0.0;
        distanceWalkedM = 0;
        activeKcal = 0;
        avgHeartRateBpm = 0;
        maxHeartRateBpm = 0;
        mHrSum = 0;
        mHrSamples = 0;
        mStartElapsedDistM = null;
        mLastLat = null;
        mLastLon = null;
        mConfirmFinishUntilMs = 0;
        mConfirmResetUntilMs = 0;
        mConfirmExitUntilMs = 0;
        if (Toybox has :ActivityMonitor) {
            var monInfo = ActivityMonitor.getInfo();
            if (monInfo != null && (monInfo has :steps) && monInfo.steps != null) {
                mBaselineSteps = monInfo.steps;
                mLastObservedSteps = monInfo.steps;
            }
        }
        syncGpsTrackingState();
        saveStateToStorage();
        WatchUi.requestUpdate();
    }

    function processInertialSample25Hz(
        ax as Lang.Float,
        ay as Lang.Float,
        az as Lang.Float,
        gyRad as Lang.Float,
        gzRad as Lang.Float,
        dtMs as Lang.Number,
        now as Lang.Number
    ) as Void {
        mLastSampleAx = ax;
        mLastSampleAy = ay;
        mLastSampleAz = az;

        var rawMag = Math.sqrt(ax * ax + ay * ay + az * az).toFloat();
        var jerkMg = (rawMag - mPrevRawMagMg).abs();
        mPrevRawMagMg = rawMag;
        var linDevMg = (rawMag - 1000.0).abs();
        var gyroMag = Math.sqrt(gyRad * gyRad + gzRad * gzRad).toFloat();

        // Hands-free 25Hz 4-stage AUTO shot detector (Raise -> Sustained Anchor -> Release Impulse -> 200ms Follow-Through)
        if (analysisMode && autoDetectEnabled && !manualAnalysisRecording) {
            var isWalking = (mLastStepTickMs > 0 && now >= mLastStepTickMs && (now - mLastStepTickMs) < 4800);
            if (isWalking) {
                mAutoQuietMs = 0;
                mAutoPendingMs = 0;
            } else if (mAutoPendingMs > 0) {
                var elapsed = now - mAutoPendingMs;
                if (elapsed >= 80 && elapsed <= 240) {
                    mAutoFollowLinSum = mAutoFollowLinSum + linDevMg;
                    mAutoFollowAxSum = mAutoFollowAxSum + ax.abs();
                    mAutoFollowCnt = mAutoFollowCnt + 1;
                }
                if (elapsed >= 220) {
                    var trigMs = mAutoPendingMs;
                    mAutoPendingMs = 0;
                    mAutoQuietMs = 0;
                    var followOk = (mAutoFollowCnt >= 2)
                        && ((mAutoFollowLinSum / mAutoFollowCnt) <= 820.0)
                        && ((mAutoFollowAxSum / mAutoFollowCnt) <= 820.0);
                    if (followOk && (mLastAutoShotMs == 0 || now < mLastAutoShotMs || (now - mLastAutoShotMs) >= 5500)) {
                        mLastAutoShotMs = now;
                        if (Attention has :vibrate) {
                            Attention.vibrate([
                                new Attention.VibeProfile(70, 50),
                                new Attention.VibeProfile(0, 40),
                                new Attention.VibeProfile(85, 75)
                            ]);
                        }
                        finalizeAnalysisWindow(trigMs - 9500, now, false, true);
                    }
                }
            } else {
                var gNorm = (rawMag > 400.0) ? rawMag : 1000.0;
                var perpG = Math.sqrt(ay * ay + az * az).toFloat();
                var postureHoriz = ((ax.abs() / gNorm) <= 0.78) && (perpG >= 560.0);
                if (postureHoriz && linDevMg <= 135.0 && gyroMag <= 0.48) {
                    mAutoQuietMs = mAutoQuietMs + dtMs;
                    if (mAutoQuietMs > 15000) { mAutoQuietMs = 15000; }
                } else if (mAutoQuietMs >= 1000) {
                    var minJerk = bowTypeStr.equals("Compound") ? 290.0 : (bowTypeStr.equals("Recurve") ? 225.0 : 255.0);
                    var minImpulse = bowTypeStr.equals("Compound") ? 250.0 : (bowTypeStr.equals("Recurve") ? 195.0 : 220.0);
                    if (jerkMg >= minJerk && (linDevMg + gyroMag * 110.0) >= minImpulse) {
                        mAutoPendingMs = now;
                        mAutoFollowLinSum = 0.0;
                        mAutoFollowAxSum = 0.0;
                        mAutoFollowCnt = 0;
                    } else if (!postureHoriz || linDevMg > 260.0) {
                        mAutoQuietMs = 0;
                    }
                } else {
                    mAutoQuietMs = 0;
                }
            }
        }

        // Anti-aliasing boxcar filter + 25Hz peak shock preservation into circular trajectory buffer
        if (analysisMode) {
            mBoxSumAx = mBoxSumAx + ax;
            mBoxSumAy = mBoxSumAy + ay;
            mBoxSumAz = mBoxSumAz + az;
            mBoxSumGy = mBoxSumGy + gyRad;
            mBoxSumGz = mBoxSumGz + gzRad;
            mBoxCnt = mBoxCnt + 1;
            if (jerkMg > mBoxPeakJerkMg) {
                mBoxPeakJerkMg = jerkMg;
            }

            var sampleGapMs = isLowRamDevice ? 125 : 95;
            if (now < mLastAnaSampleMs || (now - mLastAnaSampleMs) >= sampleGapMs) {
                ensureAnalysisBuffersAllocated();
                var tBuf = mAnaT;
                var xBuf = mAnaAx;
                var yBuf = mAnaAy;
                var zBuf = mAnaAz;
                var pBuf = mAnaPeak;
                if (tBuf != null && xBuf != null && yBuf != null && zBuf != null && pBuf != null && mBoxCnt > 0) {
                    mLastAnaSampleMs = now;
                    tBuf[mAnaIdx] = now;
                    xBuf[mAnaIdx] = (mBoxSumAx / mBoxCnt).toFloat();
                    yBuf[mAnaIdx] = (mBoxSumAy / mBoxCnt).toFloat();
                    zBuf[mAnaIdx] = (mBoxSumAz / mBoxCnt).toFloat();
                    pBuf[mAnaIdx] = mBoxPeakJerkMg;
                    var gyBuf = mAnaGy;
                    var gzBuf = mAnaGz;
                    if (gyBuf != null && gzBuf != null) {
                        gyBuf[mAnaIdx] = (mBoxSumGy / mBoxCnt).toFloat();
                        gzBuf[mAnaIdx] = (mBoxSumGz / mBoxCnt).toFloat();
                    }
                    mAnaIdx = (mAnaIdx + 1) % mAnaSize;
                    if (mAnaCount < mAnaSize) {
                        mAnaCount = mAnaCount + 1;
                    }
                }
                mBoxSumAx = 0.0;
                mBoxSumAy = 0.0;
                mBoxSumAz = 0.0;
                mBoxSumGy = 0.0;
                mBoxSumGz = 0.0;
                mBoxCnt = 0;
                mBoxPeakJerkMg = 0.0;
            }
        }
    }

    function processAccelSampleMg(ax as Lang.Float, ay as Lang.Float, az as Lang.Float, now as Lang.Number) as Void {
        processInertialSample25Hz(ax, ay, az, 0.0, 0.0, 100, now);
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
        var gys = null;
        var gzs = null;
        if (mHasHardwareGyro && (sensorData has :gyroscopeData) && sensorData.gyroscopeData != null) {
            var gyr = sensorData.gyroscopeData;
            gys = gyr.y;
            gzs = gyr.z;
        }
        var batchEndMs = System.getTimer();
        var n = xs.size();
        var dtMs = (n > 1) ? (1000 / n) : 40;
        for (var i = 0; i < n; i++) {
            var sampleMs = batchEndMs - ((n - 1 - i) * dtMs);
            var gyRad = (gys != null && i < gys.size() && gys[i] != null) ? (gys[i].toFloat() * 0.0174533) : 0.0;
            var gzRad = (gzs != null && i < gzs.size() && gzs[i] != null) ? (gzs[i].toFloat() * 0.0174533) : 0.0;
            processInertialSample25Hz(xs[i].toFloat(), ys[i].toFloat(), zs[i].toFloat(), gyRad, gzRad, dtMs, sampleMs);
        }
    }

    function onSensorTick() as Void {
        var now = System.getTimer();

        // Always update ActivityMonitor steps
        if (Toybox has :ActivityMonitor) {
            var monInfo = ActivityMonitor.getInfo();
            if (monInfo != null && (monInfo has :steps)) {
                var curMonSteps = monInfo.steps;
                if (curMonSteps != null) {
                    var baseSteps = mBaselineSteps;
                    if (baseSteps == null || curMonSteps < baseSteps) {
                        baseSteps = curMonSteps;
                        mBaselineSteps = baseSteps;
                    }
                    var lastObs = mLastObservedSteps;
                    if (lastObs != null && curMonSteps > lastObs) {
                        mLastObservedSteps = curMonSteps;
                        mLastStepTickMs = now;
                        var deltaSteps = curMonSteps - baseSteps;
                        if (deltaSteps > stepsCount) {
                            stepsCount = deltaSteps;
                        }
                        recalculateMetrics();
                        if ((stepsCount - mLastTelemetryPushSteps) >= 3 && hasPairingCode && isValidPairingCode(pairingCode)) {
                            mLastTelemetryPushSteps = stepsCount;
                            sendTelemetryPing();
                        }
                        WatchUi.requestUpdate();
                    } else if (lastObs == null) {
                        mLastObservedSteps = curMonSteps;
                    }
                }
            }
        }

        // Sample optical heart rate every ~2.0s
        if (now < mLastHrSampleMs || (now - mLastHrSampleMs) >= 2000) {
            mLastHrSampleMs = now;
            try {
                var curHr = 0;
                var hrInfo = Sensor.getInfo();
                if (hrInfo != null && (hrInfo has :heartRate)) {
                    var hrVal = hrInfo.heartRate;
                    if (hrVal != null) {
                        curHr = hrVal.toNumber();
                    }
                }
                if (curHr == 0 && (Toybox has :ActivityMonitor) && (ActivityMonitor has :getHeartRateHistory)) {
                    var hrIter = ActivityMonitor.getHeartRateHistory(1, true);
                    if (hrIter != null) {
                        var hrSample = hrIter.next();
                        if (hrSample != null) {
                            var histHr = hrSample.heartRate;
                            if (histHr != null && histHr != ActivityMonitor.INVALID_HR_SAMPLE) {
                                curHr = histHr.toNumber();
                            }
                        }
                    }
                }
                if (curHr >= 35 && curHr <= 240) {
                    var prevHr = heartRateBpm;
                    heartRateBpm = curHr;
                    mHrSum = mHrSum + curHr;
                    mHrSamples = mHrSamples + 1;
                    avgHeartRateBpm = (mHrSum / mHrSamples).toNumber();
                    if (curHr > maxHeartRateBpm) {
                        maxHeartRateBpm = curHr;
                    }
                    if (hasPairingCode && isValidPairingCode(pairingCode) && !isEditingCode) {
                        var hrDelta = (curHr - prevHr).abs();
                        if (mLastHrPushMs == 0 || now < mLastHrPushMs || (now - mLastHrPushMs) >= 6000 || (hrDelta >= 2 && (now - mLastHrPushMs) >= 2500)) {
                            mLastHrPushMs = now;
                            sendTelemetryPing();
                        }
                    }
                }
            } catch (ex) {}
        }

        // 3-Tier Adaptive Cloud Polling + Offline Queue Retry
        if (hasPairingCode && isValidPairingCode(pairingCode) && !isEditingCode) {
            if (mHandshakeBlockedCode.length() == 0 || !mHandshakeBlockedCode.equals(pairingCode)) {
                if (now < mLastCloudPollMs) {
                    mLastCloudPollMs = now;
                }
                var pollIntervalMs = (mPendingCmdQueue.size() > 0) ? 5000 : getAdaptiveCloudPollIntervalMs(now);
                var sinceLocalMs = (now >= mLastLocalActionMs) ? (now - mLastLocalActionMs) : 999999;
                if ((now - mLastCloudPollMs) >= pollIntervalMs && sinceLocalMs >= 1500) {
                    mLastCloudPollMs = now;
                    pollFirestoreCloud();
                }
            }
        }

        // Fallback single-sample accel check when high-freq listener is unavailable during Analysis mode
        if (analysisMode && !mHighFreqAccelActive) {
            var info = Sensor.getInfo();
            if (info != null && (info has :accel)) {
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
        if (analysisMode && manualAnalysisRecording) {
            if ((now - manualAnalysisStartTimerMs) >= 24000) {
                stopManualAnalysis(true);
            } else {
                WatchUi.requestUpdate();
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
            var nextBleSig = (bleAct ? "1|" : "0|") + bleSid + "|" + bleArr.toString() + "|" + bleScore.toString() + "|" + bleEnd.toString();
            if (mLastBleStateSig.length() == 0) {
                mLastBleStateSig = nextBleSig;
            } else if (!nextBleSig.equals(mLastBleStateSig)) {
                mLastBleStateSig = nextBleSig;
                mLastActivityMs = System.getTimer();
            }

            if (!bleAct) {
                if (mPendingCmdQueue.size() == 0) {
                    resetAllCounters("");
                }
                return;
            }
            if (bleSid.length() > 0 && currentSessionId.length() > 0 && !bleSid.equals(currentSessionId)) {
                if (mPendingCmdQueue.size() == 0) {
                    resetAllCounters(bleSid);
                }
            } else if (bleSid.length() > 0) {
                currentSessionId = bleSid;
            }
            if (mPendingCmdQueue.size() == 0 && !mAwaitingPhoneSync) {
                if (data.hasKey("arrowsCount")) {
                    arrowsCount = bleArr;
                }
                if (data.hasKey("totalScore")) {
                    totalScore = bleScore;
                }
                if (data.hasKey("currentEndIndex")) {
                    currentEnd = bleEnd;
                }
            }
            if (data.hasKey("distanceM")) {
                distanceM = data["distanceM"].toNumber();
            }
            if (data.hasKey("gpsActive")) {
                mRemoteGpsActive = (data["gpsActive"] == true);
            }
            if (data.hasKey("arrowsPerEnd")) {
                arrowsPerEnd = data["arrowsPerEnd"].toNumber();
            }
            if (data.hasKey("endsCount")) {
                endsCount = data["endsCount"].toNumber();
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
            syncGpsTrackingState();
            saveStateToStorage();
            WatchUi.requestUpdate();
        }
    }

    function updateGpsPosition(info as Position.Info?) as Void {
        if (info == null) {
            return;
        }
        if (info has :elapsedDistance) {
            var rawElapsed = info.elapsedDistance as Lang.Number or Lang.Float or Null;
            if (rawElapsed != null) {
                var curElapsed = rawElapsed.toFloat();
                if (curElapsed > 0.0) {
                    var startEl = mStartElapsedDistM;
                    if (startEl == null || curElapsed < startEl) {
                        startEl = curElapsed;
                        mStartElapsedDistM = startEl;
                    }
                    var deltaM = curElapsed - startEl;
                    if (deltaM > gpsDistanceM) {
                        gpsDistanceM = deltaM;
                        recalculateMetrics();
                        WatchUi.requestUpdate();
                    }
                    return;
                }
            }
        }

        var acc = info.accuracy;
        var pos = info.position;
        if (acc != null && acc >= Position.QUALITY_POOR && pos != null) {
            var spdOk = true;
            if (info has :speed) {
                var rawSpd = info.speed;
                if (rawSpd != null) {
                    var spd = rawSpd.toFloat();
                    if (spd < 0.48 || spd > 5.8) {
                        spdOk = false;
                    }
                } else if (acc < Position.QUALITY_USABLE) {
                    spdOk = false;
                }
            } else if (acc < Position.QUALITY_USABLE) {
                spdOk = false;
            }
            var radians = pos.toRadians();
            var lat = radians[0].toDouble();
            var lon = radians[1].toDouble();
            var prevLat = mLastLat;
            var prevLon = mLastLon;
            if (prevLat != null && prevLon != null) {
                var R = 6371000.0;
                var dLat = lat - prevLat;
                var dLon = lon - prevLon;
                var a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0) +
                        Math.cos(prevLat) * Math.cos(lat) * Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);
                var c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
                var stepM = (R * c).toFloat();
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
        mAwaitingPhoneSync = true;
        if (Attention has :vibrate) {
            var vibe = [new Attention.VibeProfile(isAuto ? 85 : 55, isAuto ? 110 : 50)];
            Attention.vibrate(vibe);
        }
        recalculateMetrics();
        syncGpsTrackingState();
        var evt = (delta >= 0) ? "INCREMENT_ARROW" : "DECREMENT_ARROW";
        enqueueWatchCommand(evt, isAuto ? "watch_auto" : "watch_manual", (delta >= 0) ? 1 : -1);
        saveStateToStorage();
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
        mAwaitingPhoneSync = true;
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(65, 60)]);
        }
        recalculateMetrics();
        syncGpsTrackingState();
        enqueueWatchCommand("SCORE_INPUT", val, 1);
        saveStateToStorage();
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
        mAwaitingPhoneSync = true;
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(50, 40)]);
        }
        recalculateMetrics();
        enqueueWatchCommand("UNDO_ARROW", "", -1);
        saveStateToStorage();
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
        mAwaitingPhoneSync = true;
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(70, 60)]);
        }
        enqueueWatchCommand("NEXT_END", "", 0);
        saveStateToStorage();
        WatchUi.requestUpdate();
    }

    function hasValidActiveLink() as Lang.Boolean {
        if (isBleConnected) {
            return true;
        }
        if (hasPairingCode && isValidPairingCode(pairingCode) && isValidSessionToken(mCloudSessionToken)
            && !mCloudErrorState.equals("EXPIRED") && !mCloudErrorState.equals("INVALID")) {
            return true;
        }
        return false;
    }

    function requestSafeFinishSession() as Void {
        var now = System.getTimer();
        markUserActivity(true);
        mConfirmResetUntilMs = 0;

        // AUD-GAR-02: Never wipe local arrows when unpaired or cloud session expired/invalid
        if (!hasValidActiveLink()) {
            mConfirmFinishUntilMs = 0;
            mFinishWarnUntilMs = now + 4200;
            if (Attention has :vibrate) {
                Attention.vibrate([
                    new Attention.VibeProfile(80, 50),
                    new Attention.VibeProfile(0, 45),
                    new Attention.VibeProfile(80, 50)
                ]);
            }
            WatchUi.requestUpdate();
            return;
        }

        // Step 1 of 2-step confirmation: arm for 5 seconds
        if (now >= mConfirmFinishUntilMs) {
            mConfirmFinishUntilMs = now + 5000;
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(55, 45)]);
            }
            WatchUi.requestUpdate();
            return;
        }

        // Step 2 confirmed: enqueue persistent FINISH_SESSION_FROM_WATCH snapshot first, persist to Storage, then reset active counters
        mConfirmFinishUntilMs = 0;
        mLastLocalActionMs = now;
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(85, 110)]);
        }
        lastSavedFeedbackMs = now + 3200;
        enqueueWatchCommand("FINISH_SESSION_FROM_WATCH", "", 0);
        saveQueueToStorage();
        resetAllCounters("");
        WatchUi.requestUpdate();
    }

    function requestSafeResetSession() as Void {
        var now = System.getTimer();
        markUserActivity(false);
        mConfirmFinishUntilMs = 0;

        if (arrowsCount > 0 && now >= mConfirmResetUntilMs) {
            mConfirmResetUntilMs = now + 5000;
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(55, 45)]);
            }
            WatchUi.requestUpdate();
            return;
        }

        mConfirmResetUntilMs = 0;
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(55, 50)]);
        }
        lastSavedFeedbackMs = 0;
        mAwaitingPhoneSync = false;
        resetAllCounters("");
        screenIdx = 0;
        WatchUi.requestUpdate();
    }

    function fmtMilli3(val as Lang.Float) as Lang.String {
        var clamped = val;
        if (clamped > 1.08) { clamped = 1.08; }
        if (clamped < -1.08) { clamped = -1.08; }
        var neg = (clamped < 0.0);
        var absVal = neg ? -clamped : clamped;
        var scaled = (absVal * 1000.0 + 0.5).toNumber();
        var whole = scaled / 1000;
        var frac = scaled % 1000;
        var pad = (frac < 10) ? "00" : ((frac < 100) ? "0" : "");
        return (neg ? "-" : "") + whole.toString() + "." + pad + frac.toString();
    }

    function fmtTenths1(val as Lang.Float) as Lang.String {
        var safe = (val >= 0.0) ? val : 0.0;
        var scaled = (safe * 10.0 + 0.5).toNumber();
        return (scaled / 10).toString() + "." + (scaled % 10).toString();
    }

    function startManualAnalysis(notifyPhone as Lang.Boolean) as Void {
        startManualAnalysisWithLag(notifyPhone, 0);
    }

    function startManualAnalysisWithLag(notifyPhone as Lang.Boolean, lagMs as Lang.Number) as Void {
        if (!analysisMode || manualAnalysisRecording) {
            return;
        }
        ensureAnalysisBuffersAllocated();
        manualAnalysisRecording = true;
        var nowT = System.getTimer();
        var safeLag = (lagMs > 0 && lagMs <= 12000) ? lagMs : 0;
        manualAnalysisStartTimerMs = nowT - safeLag;
        screenIdx = 0;
        mLastLocalActionMs = nowT;
        markUserActivity(true);
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(75, 70)]);
        }
        if (notifyPhone) {
            enqueueWatchCommand("ANALYSIS_MANUAL_START", "", 0);
        }
        WatchUi.requestUpdate();
    }

    (:typecheck(false))
    function stopManualAnalysis(notifyPhone as Lang.Boolean) as Void {
        stopManualAnalysisWithLag(notifyPhone, 0);
    }

    (:typecheck(false))
    function stopManualAnalysisWithLag(notifyPhone as Lang.Boolean, lagMs as Lang.Number) as Void {
        if (!manualAnalysisRecording) {
            return;
        }
        var nowT = System.getTimer();
        var safeLag = (lagMs > 0 && lagMs <= 9000) ? lagMs : 0;
        var endTimer = nowT - safeLag;
        var startTimer = manualAnalysisStartTimerMs;
        if (endTimer <= startTimer + 350) {
            endTimer = nowT;
        }
        manualAnalysisRecording = false;
        manualAnalysisStartTimerMs = 0;
        mLastLocalActionMs = nowT;
        markUserActivity(true);
        if (Attention has :vibrate) {
            Attention.vibrate([
                new Attention.VibeProfile(70, 55),
                new Attention.VibeProfile(0, 45),
                new Attention.VibeProfile(90, 90)
            ]);
        }
        finalizeAnalysisWindow(startTimer, endTimer, notifyPhone, false);
    }

    (:typecheck(false))
    function finalizeAnalysisWindow(
        startTimer as Lang.Number,
        endTimer as Lang.Number,
        notifyPhoneStopFallback as Lang.Boolean,
        isAutoShot as Lang.Boolean
    ) as Void {
        var tBuf = mAnaT;
        var xBuf = mAnaAx;
        var yBuf = mAnaAy;
        var zBuf = mAnaAz;
        var pBuf = mAnaPeak;
        var gyBuf = mAnaGy;
        var gzBuf = mAnaGz;
        if (tBuf == null || xBuf == null || yBuf == null || zBuf == null) {
            if (notifyPhoneStopFallback) {
                enqueueWatchCommand("ANALYSIS_MANUAL_STOP", "", 0);
            }
            WatchUi.requestUpdate();
            return;
        }

        var count = 0;
        for (var i = 0; i < mAnaCount; i++) {
            var idx = (mAnaIdx - 1 - i + mAnaSize) % mAnaSize;
            var st = tBuf[idx];
            if (st != null && st >= startTimer && st <= endTimer) {
                count = count + 1;
            }
        }
        if (count < 4) {
            if (notifyPhoneStopFallback) {
                enqueueWatchCommand("ANALYSIS_MANUAL_STOP", "", 0);
            }
            WatchUi.requestUpdate();
            return;
        }

        var xs = new [count] as Lang.Array<Lang.Float>;
        var ys = new [count] as Lang.Array<Lang.Float>;
        var zs = new [count] as Lang.Array<Lang.Float>;
        var pks = new [count] as Lang.Array<Lang.Float>;
        var gys = new [count] as Lang.Array<Lang.Float>;
        var gzs = new [count] as Lang.Array<Lang.Float>;
        var tsArr = new [count] as Lang.Array<Lang.Number>;
        var k = count - 1;
        for (var j = 0; j < mAnaCount && k >= 0; j++) {
            var rIdx = (mAnaIdx - 1 - j + mAnaSize) % mAnaSize;
            var rt = tBuf[rIdx];
            if (rt != null && rt >= startTimer && rt <= endTimer) {
                tsArr[k] = rt;
                xs[k] = xBuf[rIdx];
                ys[k] = yBuf[rIdx];
                zs[k] = zBuf[rIdx];
                pks[k] = (pBuf != null && pBuf[rIdx] != null) ? pBuf[rIdx] : 0.0;
                gys[k] = (gyBuf != null && gyBuf[rIdx] != null) ? gyBuf[rIdx] : 0.0;
                gzs[k] = (gzBuf != null && gzBuf[rIdx] != null) ? gzBuf[rIdx] : 0.0;
                k = k - 1;
            }
        }

        // Step 1: Locate sustained horizontal aiming plateau & trim post-release arm lowering / FINAL tap delay
        var bestPlatIdx = (count >= 6) ? (count - 2) : (count - 1);
        var bestPlatScore = -1.0;
        var curRunLen = 0;
        var platAx = xs[bestPlatIdx];
        var platAy = ys[bestPlatIdx];
        var platAz = zs[bestPlatIdx];
        for (var pScan = 3; pScan < count; pScan++) {
            var sumLin = 0.0;
            var mAx = 0.0;
            var mAy = 0.0;
            var mAz = 0.0;
            var minY = 99999.0;
            var maxY = -99999.0;
            var minZ = 99999.0;
            var maxZ = -99999.0;
            var wCnt = 0;
            var wFrom = (pScan >= 4) ? (pScan - 4) : 0;
            for (var w = wFrom; w <= pScan; w++) {
                var magW = Math.sqrt(xs[w] * xs[w] + ys[w] * ys[w] + zs[w] * zs[w]).toFloat();
                sumLin = sumLin + (magW - 1000.0).abs();
                mAx = mAx + xs[w];
                mAy = mAy + ys[w];
                mAz = mAz + zs[w];
                if (ys[w] < minY) { minY = ys[w]; }
                if (ys[w] > maxY) { maxY = ys[w]; }
                if (zs[w] < minZ) { minZ = zs[w]; }
                if (zs[w] > maxZ) { maxZ = zs[w]; }
                wCnt = wCnt + 1;
            }
            mAx = mAx / wCnt;
            mAy = mAy / wCnt;
            mAz = mAz / wCnt;
            var gNormW = Math.sqrt(mAx * mAx + mAy * mAy + mAz * mAz).toFloat();
            if (gNormW < 400.0) { gNormW = 1000.0; }
            var perpG = Math.sqrt(mAy * mAy + mAz * mAz).toFloat();
            var postureOk = ((mAx.abs() / gNormW) <= 0.80) && (perpG >= 560.0);
            var spanOk = ((maxY - minY) <= 245.0) && ((maxZ - minZ) <= 245.0);
            if (postureOk && spanOk && (sumLin / wCnt) <= 135.0) {
                curRunLen = curRunLen + 1;
                if (curRunLen >= 4 && (tsArr[pScan] - tsArr[0]) >= 600) {
                    var recBonus = ((pScan.toFloat() / count.toFloat()) * 3.5);
                    var pScore = curRunLen.toFloat() + recBonus;
                    if (pScore >= bestPlatScore) {
                        bestPlatScore = pScore;
                        bestPlatIdx = pScan;
                        platAx = mAx;
                        platAy = mAy;
                        platAz = mAz;
                    }
                }
            } else {
                curRunLen = 0;
            }
        }

        // Step 2: Pinpoint exact bowstring release shock (preserving 25Hz sub-sample peak jerk!) or onset of arm drop
        var effCount = (count >= 6) ? (count - 1) : count;
        if (bestPlatScore > 0.0) {
            effCount = (bestPlatIdx + 1 <= count) ? (bestPlatIdx + 1) : count;
            var relStart = (bestPlatIdx >= 2) ? (bestPlatIdx - 2) : 1;
            for (var rScan = relStart; rScan < count; rScan++) {
                var magCur = Math.sqrt(xs[rScan] * xs[rScan] + ys[rScan] * ys[rScan] + zs[rScan] * zs[rScan]).toFloat();
                var magPrev = Math.sqrt(xs[rScan - 1] * xs[rScan - 1] + ys[rScan - 1] * ys[rScan - 1] + zs[rScan - 1] * zs[rScan - 1]).toFloat();
                var jerkMg = (magCur - magPrev).abs();
                if (pks[rScan] > jerkMg) { jerkMg = pks[rScan]; }
                var linDevMg = (magCur - 1000.0).abs();
                var dPx = xs[rScan] - platAx;
                var dPy = ys[rScan] - platAy;
                var dPz = zs[rScan] - platAz;
                var dropDistMg = Math.sqrt(dPx * dPx + dPy * dPy + dPz * dPz).toFloat();
                if (jerkMg >= 210.0 || linDevMg >= 185.0 || (rScan > bestPlatIdx && dropDistMg >= 245.0)) {
                    effCount = (rScan >= 4) ? rScan : 4;
                    break;
                }
            }
        }
        if (effCount > count) { effCount = count; }
        if (effCount < 4) { effCount = (count >= 4) ? 4 : count; }

        var refStart = (effCount > 6) ? (effCount - 6) : 0;
        var refAy = 0.0;
        var refAz = 0.0;
        var refAx = 0.0;
        var refGy = 0.0;
        var refGz = 0.0;
        var refN = 0;
        for (var r = refStart; r < effCount; r++) {
            refAx = refAx + xs[r];
            refAy = refAy + ys[r];
            refAz = refAz + zs[r];
            refGy = refGy + gys[r];
            refGz = refGz + gzs[r];
            refN = refN + 1;
        }
        refAx = refAx / refN;
        refAy = refAy / refN;
        refAz = refAz / refN;
        var biasGy = refGy / refN;
        var biasGz = refGz / refN;
        if (biasGy > 0.045) { biasGy = 0.045; }
        if (biasGy < -0.045) { biasGy = -0.045; }
        if (biasGz > 0.045) { biasGz = 0.045; }
        if (biasGz < -0.045) { biasGz = -0.045; }
        var refNorm = Math.sqrt(refAx * refAx + refAy * refAy + refAz * refAz).toFloat();
        if (refNorm < 400.0) { refNorm = 1000.0; }

        var faceRadiusCm = (distanceM <= 20) ? 20.0 : ((distanceM <= 26) ? 30.0 : ((distanceM <= 36) ? 40.0 : 61.0));
        var distCm = (distanceM * 100.0 > 1000.0) ? (distanceM * 100.0) : 1000.0;
        var wristSign = bowWristStr.equals("RIGHT") ? -1.0 : 1.0;
        var forePitchWeight = (refAz.abs() < 750.0) ? 0.85 : 0.35;

        var nxArr = new [effCount] as Lang.Array<Lang.Float>;
        var nyArr = new [effCount] as Lang.Array<Lang.Float>;
        var gdArr = new [effCount] as Lang.Array<Lang.Float>;
        var sAx = xs[0];
        var sAy = ys[0];
        var sAz = zs[0];
        var gYaw = 0.0;
        var gPitch = 0.0;
        for (var m = 0; m < effCount; m++) {
            var dtSec = (m > 0) ? ((tsArr[m] - tsArr[m - 1]).toFloat() / 1000.0) : 0.10;
            if (dtSec < 0.02) { dtSec = 0.02; }
            if (dtSec > 0.20) { dtSec = 0.20; }
            sAx = 0.80 * sAx + 0.20 * xs[m];
            sAy = 0.80 * sAy + 0.20 * ys[m];
            sAz = 0.80 * sAz + 0.20 * zs[m];
            var tiltH = ((sAy - refAy) / refNorm) * wristSign * 0.28;
            var tiltV = (((sAz - refAz) + (sAx - refAx) * wristSign * forePitchWeight) / refNorm) * 0.28;
            var yawRad = tiltH;
            var pitchRad = tiltV;
            if (mHasHardwareGyro && !isLowRamDevice) {
                gYaw = 0.88 * (gYaw + (gzs[m] - biasGz) * dtSec * wristSign * 0.28) + 0.12 * tiltH;
                gPitch = 0.88 * (gPitch + (gys[m] - biasGy) * dtSec * 0.28) + 0.12 * tiltV;
                yawRad = tiltH * 0.65 + gYaw * 0.35;
                pitchRad = tiltV * 0.65 + gPitch * 0.35;
            }
            var dxCm = Math.tan(yawRad).toFloat() * distCm;
            var dyCm = Math.tan(pitchRad).toFloat() * distCm;
            nxArr[m] = (dxCm / faceRadiusCm).toFloat();
            nyArr[m] = (dyCm / faceRadiusCm).toFloat();
            var dGx = sAx - refAx;
            var dGy = sAy - refAy;
            var dGz = sAz - refAz;
            gdArr[m] = Math.sqrt(dGx * dGx + dGy * dGy + dGz * dGz).toFloat();
        }

        var baseGd = 0.0;
        var baseN = 0;
        for (var b = refStart; b < effCount; b++) {
            baseGd = baseGd + gdArr[b];
            baseN = baseN + 1;
        }
        var gdLimitMg = (baseN > 0) ? ((baseGd / baseN) * 2.15 + 20.0) : 38.0;
        if (gdLimitMg < 36.0) { gdLimitMg = 36.0; }
        if (gdLimitMg > 105.0) { gdLimitMg = 105.0; }

        var settleIdx = 1;
        for (var sIdx = effCount - 2; sIdx >= 1; sIdx--) {
            var radNorm = Math.sqrt(nxArr[sIdx] * nxArr[sIdx] + nyArr[sIdx] * nyArr[sIdx]).toFloat();
            var prevIdx = (sIdx >= 4) ? (sIdx - 4) : 0;
            var driftMg = (gdArr[sIdx] - gdArr[prevIdx]).abs();
            var pathLenNorm = 0.0;
            for (var pStep = sIdx; pStep > prevIdx; pStep--) {
                var sDx = nxArr[pStep] - nxArr[pStep - 1];
                var sDy = nyArr[pStep] - nyArr[pStep - 1];
                pathLenNorm = pathLenNorm + Math.sqrt(sDx * sDx + sDy * sDy).toFloat();
            }
            var dNx = nxArr[sIdx] - nxArr[prevIdx];
            var dNy = nyArr[sIdx] - nyArr[prevIdx];
            var netDriftNorm = Math.sqrt(dNx * dNx + dNy * dNy).toFloat();
            var oldestRadNorm = Math.sqrt(nxArr[prevIdx] * nxArr[prevIdx] + nyArr[prevIdx] * nyArr[prevIdx]).toFloat();
            var isMonotonicApproach = (oldestRadNorm > 0.18 && netDriftNorm > 0.21 && pathLenNorm > 0.01 && (netDriftNorm / pathLenNorm) >= 0.82);
            if (gdArr[sIdx] > gdLimitMg || radNorm > 0.24 || driftMg > 29.0 || isMonotonicApproach) {
                var priorIdx = (sIdx >= 6) ? (sIdx - 6) : 0;
                if (sIdx < 6 || gdArr[priorIdx] > gdLimitMg || Math.sqrt(nxArr[priorIdx] * nxArr[priorIdx] + nyArr[priorIdx] * nyArr[priorIdx]).toFloat() > 0.24) {
                    settleIdx = sIdx + 1;
                    break;
                }
            }
            settleIdx = sIdx;
        }
        if (settleIdx < 1) { settleIdx = 1; }
        if (settleIdx > effCount - 2) { settleIdx = effCount - 2; }

        var prepStartIdx = 0;
        var sawLift = false;
        for (var pIdx = settleIdx - 1; pIdx >= 1; pIdx--) {
            var stepShiftMg = (gdArr[pIdx] - gdArr[pIdx - 1]).abs();
            var armLoweredFromSetUp = (gdArr[pIdx] >= 225.0);
            if (stepShiftMg >= 18.0) {
                sawLift = true;
            } else if (sawLift && armLoweredFromSetUp && (tsArr[settleIdx] - tsArr[pIdx]) >= 450 && stepShiftMg < 8.5) {
                prepStartIdx = pIdx;
                break;
            }
        }

        var maxPrepCap = isAutoShot ? 6.5 : 10.0;
        var maxAimCap = isAutoShot ? 14.0 : 24.0;
        var prepSec = ((tsArr[settleIdx] - tsArr[prepStartIdx]).toFloat() / 1000.0);
        if (prepSec < 0.4) { prepSec = 0.4; }
        if (prepSec > maxPrepCap) { prepSec = maxPrepCap; }
        var aimSec = ((tsArr[effCount - 1] - tsArr[settleIdx]).toFloat() / 1000.0);
        if (aimSec < 0.5) { aimSec = 0.5; }
        if (aimSec > maxAimCap) { aimSec = maxAimCap; }

        // Zero-centered RMS Sway across Aiming + Critical 1.5s Hold MOA (matching Web & Wear OS 100%)
        var meanAimNx = 0.0;
        var meanAimNy = 0.0;
        var aimN = 0;
        for (var a0 = settleIdx; a0 < effCount; a0++) {
            meanAimNx = meanAimNx + nxArr[a0];
            meanAimNy = meanAimNy + nyArr[a0];
            aimN = aimN + 1;
        }
        if (aimN > 0) {
            meanAimNx = meanAimNx / aimN;
            meanAimNy = meanAimNy / aimN;
        }
        var sumSqCm = 0.0;
        for (var a = settleIdx; a < effCount; a++) {
            var cxCm = (nxArr[a] - meanAimNx) * faceRadiusCm;
            var cyCm = (nyArr[a] - meanAimNy) * faceRadiusCm;
            sumSqCm = sumSqCm + (cxCm * cxCm) + (cyCm * cyCm);
        }
        var swayCm = (aimN > 0) ? Math.sqrt(sumSqCm / aimN).toFloat() : 1.5;
        if (swayCm < 0.3) { swayCm = 0.3; }
        if (swayCm > faceRadiusCm) { swayCm = faceRadiusCm; }
        var stabPct = (100.0 - ((swayCm / faceRadiusCm) * 82.0) + 0.5).toNumber();
        if (stabPct < 38) { stabPct = 38; }
        if (stabPct > 99) { stabPct = 99; }

        var critFrom = settleIdx;
        for (var cScan = effCount - 1; cScan >= settleIdx; cScan--) {
            if ((tsArr[effCount - 1] - tsArr[cScan]) <= 1500) {
                critFrom = cScan;
            }
        }
        var critMx = 0.0;
        var critMy = 0.0;
        var critN = 0;
        for (var c0 = critFrom; c0 < effCount; c0++) {
            critMx = critMx + nxArr[c0];
            critMy = critMy + nyArr[c0];
            critN = critN + 1;
        }
        if (critN > 0) {
            critMx = critMx / critN;
            critMy = critMy / critN;
        }
        var critSqCm = 0.0;
        for (var c1 = critFrom; c1 < effCount; c1++) {
            var rxC = (nxArr[c1] - critMx) * faceRadiusCm;
            var ryC = (nyArr[c1] - critMy) * faceRadiusCm;
            critSqCm = critSqCm + (rxC * rxC) + (ryC * ryC);
        }
        var critRmsCm = (critN > 0) ? Math.sqrt(critSqCm / critN).toFloat() : swayCm;
        var holdMoa = (Math.atan2(critRmsCm, distCm).toFloat() * 3437.75);
        if (holdMoa < 0.4) { holdMoa = 0.4; }
        if (holdMoa > 60.0) { holdMoa = 60.0; }

        // Post-release 250ms Follow-Through stability
        var ftPct = 92;
        if (effCount < count) {
            var fAx = 0.0;
            var fAy = 0.0;
            var fAz = 0.0;
            var fN = 0;
            var fLimit = (effCount + 3 <= count) ? (effCount + 3) : count;
            for (var fi = effCount; fi < fLimit; fi++) {
                fAx = fAx + xs[fi];
                fAy = fAy + ys[fi];
                fAz = fAz + zs[fi];
                fN = fN + 1;
            }
            if (fN > 0) {
                fAx = fAx / fN;
                fAy = fAy / fN;
                fAz = fAz / fN;
                var fDriftG = Math.sqrt((fAx - refAx) * (fAx - refAx) + (fAy - refAy) * (fAy - refAy) + (fAz - refAz) * (fAz - refAz)).toFloat() / 100.0;
                var adjDrift = (fDriftG > 0.85) ? (fDriftG - 0.85) : 0.0;
                ftPct = (100.0 - adjDrift * 9.5 + 0.5).toNumber();
                if (ftPct < 42) { ftPct = 42; }
                if (ftPct > 99) { ftPct = 99; }
            }
        }

        var preIdx = (effCount >= 5) ? (effCount - 5) : 0;
        var relJumpCm = Math.sqrt(
            (nxArr[effCount - 1] - nxArr[preIdx]) * (nxArr[effCount - 1] - nxArr[preIdx]) +
            (nyArr[effCount - 1] - nyArr[preIdx]) * (nyArr[effCount - 1] - nyArr[preIdx])
        ).toFloat() * faceRadiusCm;
        if (relJumpCm < 0.2) { relJumpCm = 0.2; }
        var rdStr = (relJumpCm > faceRadiusCm * 0.16) ? "A" : ((ftPct < 72) ? "D" : "C");

        var pOut = "[";
        var prepSpan = settleIdx - prepStartIdx;
        if (prepSpan < 1) { prepSpan = 1; }
        var pSteps = (prepSpan >= 6) ? 6 : (prepSpan + 1);
        if (pSteps < 2) { pSteps = 2; }
        for (var pi = 0; pi < pSteps; pi++) {
            var srcP = prepStartIdx + ((pi * prepSpan) / (pSteps - 1));
            if (srcP >= effCount) { srcP = effCount - 1; }
            if (pi > 0) { pOut = pOut + ","; }
            pOut = pOut + "[" + fmtMilli3(nxArr[srcP]) + "," + fmtMilli3(nyArr[srcP]) + "]";
        }
        pOut = pOut + "]";

        var aOut = "[";
        var aimSpan = effCount - 1 - settleIdx;
        var aSteps = (aimSpan >= 10) ? 10 : (aimSpan + 1);
        if (aSteps < 2) { aSteps = 2; }
        for (var ai = 0; ai < aSteps; ai++) {
            var srcA = settleIdx + ((ai * aimSpan) / (aSteps - 1));
            if (srcA >= effCount) { srcA = effCount - 1; }
            if (ai > 0) { aOut = aOut + ","; }
            aOut = aOut + "[" + fmtMilli3(nxArr[srcA]) + "," + fmtMilli3(nyArr[srcA]) + "]";
        }
        aOut = aOut + "]";

        arrowsCount = arrowsCount + 1;
        mAwaitingPhoneSync = true;
        lastAnalysisStabPct = stabPct;
        var epochMsStr = (Time.now().value().toLong() * 1000l + (endTimer % 1000)).toString();
        var rPair = "[" + fmtMilli3(nxArr[effCount - 1]) + "," + fmtMilli3(nyArr[effCount - 1]) + "]";
        var hrPart = (heartRateBpm >= 35 && heartRateBpm <= 240) ? (",\"bpm\":" + heartRateBpm.toString()) : "";
        var safeBow = (bowTypeStr.length() > 30) ? bowTypeStr.substring(0, 30) : bowTypeStr;
        var shotJson =
            "{\"id\":\"SHOT-" + epochMsStr + "-" + arrowsCount.toString() + "\"" +
            ",\"n\":" + arrowsCount.toString() +
            ",\"ts\":" + epochMsStr +
            ",\"d\":" + distanceM.toString() +
            ",\"bowType\":\"" + safeBow + "\"" +
            ",\"prepSec\":" + fmtTenths1(prepSec) +
            ",\"aimSec\":" + fmtTenths1(aimSec) +
            ",\"stab\":" + stabPct.toString() +
            ",\"swayCm\":" + fmtTenths1(swayCm) +
            ",\"moa\":" + fmtTenths1(holdMoa) +
            ",\"relCm\":" + fmtTenths1(relJumpCm) +
            ",\"ft\":" + ftPct.toString() +
            ",\"rd\":\"" + rdStr + "\"" +
            hrPart +
            ",\"p\":" + pOut +
            ",\"a\":" + aOut +
            ",\"r\":" + rPair + "}";

        // Enforce Firestore rule bound: analysisShotJson <= 3500 chars
        if (shotJson.length() > 3500) {
            shotJson =
                "{\"id\":\"SHOT-" + epochMsStr + "-" + arrowsCount.toString() + "\"" +
                ",\"n\":" + arrowsCount.toString() +
                ",\"ts\":" + epochMsStr +
                ",\"d\":" + distanceM.toString() +
                ",\"bowType\":\"" + safeBow + "\"" +
                ",\"prepSec\":" + fmtTenths1(prepSec) +
                ",\"aimSec\":" + fmtTenths1(aimSec) +
                ",\"stab\":" + stabPct.toString() +
                ",\"swayCm\":" + fmtTenths1(swayCm) +
                ",\"relCm\":" + fmtTenths1(relJumpCm) +
                hrPart +
                ",\"p\":[],\"a\":[],\"r\":" + rPair + "}";
        }

        enqueueWatchCommand("ANALYSIS_SHOT", shotJson, 1);
        saveStateToStorage();
        WatchUi.requestUpdate();
    }

    function toggleManualAnalysisFromHardware() as Void {
        if (manualAnalysisRecording) {
            stopManualAnalysis(true);
        } else {
            startManualAnalysis(true);
        }
    }

    function recalculateMetrics() as Void {
        var distM = gpsDistanceM;
        if (stepsCount > 0) {
            var stepMeters = (stepsCount * 0.78).toFloat();
            if (stepMeters > distM) {
                distM = stepMeters;
            }
        }
        var distInt = distM.toNumber();
        if (distInt > distanceWalkedM) {
            distanceWalkedM = distInt;
        }

        var kcalPerArrow = 0.56 + (bowPoundageLbs * 0.0165);
        var bowKcal = arrowsCount * kcalPerArrow;
        var walkKcal = (distanceWalkedM / 1000.0) * 72.0 * 0.78;
        activeKcal = (bowKcal + walkKcal).toNumber();
    }

    // =========================================================================
    // Persistent FIFO Command Queue + BLE Companion + 256-Bit Cloud Sync Engine
    // =========================================================================

    (:typecheck(false))
    function sendBleCompanionMessage(eventType as Lang.String, extra as Lang.String) as Void {
        if (Communications has :transmit) {
            try {
                var payload = {
                    "type" => eventType,
                    "arrowsCount" => arrowsCount,
                    "totalScore" => totalScore,
                    "stepsCount" => stepsCount,
                    "distanceWalkedM" => distanceWalkedM,
                    "activeKcal" => activeKcal,
                    "sensitivityLevel" => sensitivityLevel
                };
                if (extra.length() > 0 && eventType.equals("SCORE_INPUT")) {
                    payload["value"] = extra;
                } else if (extra.length() > 0 && eventType.equals("ANALYSIS_SHOT")) {
                    payload["analysisShotJson"] = extra;
                    if (heartRateBpm >= 35) {
                        payload["heartRateBpm"] = heartRateBpm;
                    }
                }
                Communications.transmit(payload, null, new CommListener(self));
            } catch (ex) {}
        }
    }

    (:typecheck(false))
    function enqueueWatchCommand(eventType as Lang.String, valStr as Lang.String, delta as Lang.Number) as Void {
        mCmdSeq = mCmdSeq + 1;
        if (mCmdSeq > 999999999) {
            mCmdSeq = 1;
        }
        var epochMsStr = (Time.now().value().toLong() * 1000l + (System.getTimer() % 1000)).toString();
        var cmdId = "gciq-" + epochMsStr + "-" + mCmdSeq.toString();

        var safeVal = valStr;
        if (eventType.equals("ANALYSIS_SHOT") && safeVal.length() > 3500) {
            safeVal = safeVal.substring(0, 3500);
        }

        var item = {
            "id" => cmdId,
            "seq" => mCmdSeq,
            "ts" => epochMsStr,
            "t" => eventType,
            "v" => safeVal,
            "d" => clampInt(delta, -20, 20),
            "sc" => clampInt(totalScore, 0, 100000),
            "st" => clampInt(stepsCount, 0, 1000000),
            "dm" => clampInt(distanceWalkedM, 0, 1000000),
            "kc" => clampInt(activeKcal, 0, 100000),
            "hr" => clampInt(heartRateBpm, 0, 260),
            "ahr" => clampInt(avgHeartRateBpm, 0, 260),
            "mhr" => clampInt(maxHeartRateBpm, 0, 260)
        };

        if (mPendingCmdQueue.size() >= MAX_CMD_QUEUE_SIZE) {
            // Drop oldest entry only at bounded cap (24 slots) to preserve heap headroom on 96KB watches
            mPendingCmdQueue = mPendingCmdQueue.slice(1, mPendingCmdQueue.size()) as Lang.Array<Lang.Dictionary>;
        }
        mPendingCmdQueue.add(item);
        mLatestEnqueuedCmdId = cmdId;
        saveQueueToStorage();

        sendBleCompanionMessage(eventType, safeVal);
        flushNextQueuedCommand();
    }

    (:typecheck(false))
    function sendTelemetryPing() as Void {
        sendBleCompanionMessage("SYNC_TELEMETRY_FROM_WATCH", "");
        if (!hasPairingCode || !isValidPairingCode(pairingCode)) {
            return;
        }
        if (mHandshakeBlockedCode.length() > 0 && mHandshakeBlockedCode.equals(pairingCode)) {
            return;
        }
        if (!isValidSessionToken(mCloudSessionToken)) {
            startPairingHandshake();
            return;
        }
        if (mPendingCmdQueue.size() > 0) {
            flushNextQueuedCommand();
            return;
        }
        var now = System.getTimer();
        if (mPatchInFlight && now >= mPatchInFlightMs && (now - mPatchInFlightMs) < 12000) {
            return;
        }
        mCmdSeq = mCmdSeq + 1;
        if (mCmdSeq > 999999999) {
            mCmdSeq = 1;
        }
        var epochMsStr = (Time.now().value().toLong() * 1000l + (now % 1000)).toString();
        var cmdId = "gciq-hb-" + epochMsStr + "-" + mCmdSeq.toString();
        var cmdFields = {
            "type" => { "stringValue" => "SYNC_TELEMETRY_FROM_WATCH" },
            "cmdId" => { "stringValue" => cmdId },
            "_cmdId" => { "stringValue" => cmdId },
            "_ts" => { "integerValue" => epochMsStr },
            "stepsCount" => { "integerValue" => clampInt(stepsCount, 0, 1000000).toString() },
            "distanceWalkedM" => { "integerValue" => clampInt(distanceWalkedM, 0, 1000000).toString() },
            "activeKcal" => { "integerValue" => clampInt(activeKcal, 0, 100000).toString() }
        };
        if (heartRateBpm >= 35 && heartRateBpm <= 240) {
            cmdFields["heartRateBpm"] = { "integerValue" => heartRateBpm.toString() };
        }
        if (avgHeartRateBpm >= 35 && avgHeartRateBpm <= 240) {
            cmdFields["avgHeartRateBpm"] = { "integerValue" => avgHeartRateBpm.toString() };
        }
        if (maxHeartRateBpm >= 35 && maxHeartRateBpm <= 240) {
            cmdFields["maxHeartRateBpm"] = { "integerValue" => maxHeartRateBpm.toString() };
        }

        var docFields = buildTelemetryDocFields(
            cmdFields,
            cmdId,
            mCmdSeq,
            stepsCount,
            distanceWalkedM,
            activeKcal,
            heartRateBpm,
            avgHeartRateBpm,
            maxHeartRateBpm
        );
        mPatchInFlight = true;
        mPatchInFlightMs = now;
        mInFlightCmdId = "";
        sendCloudPatch(docFields);
    }

    (:typecheck(false))
    function buildTelemetryDocFields(
        cmdFields as Lang.Dictionary,
        cmdId as Lang.String,
        seqNum as Lang.Number,
        stVal as Lang.Number,
        dmVal as Lang.Number,
        kcVal as Lang.Number,
        hrVal as Lang.Number,
        ahrVal as Lang.Number,
        mhrVal as Lang.Number
    ) as Lang.Dictionary {
        ensureWatchDeviceId();
        var hbEpochMsStr = (Time.now().value().toLong() * 1000l).toString();
        var updEpochMsStr = (Time.now().value().toLong() * 1000l + (System.getTimer() % 1000)).toString();
        var docFields = {
            "lastWatchCmd" => { "mapValue" => { "fields" => cmdFields } },
            "lastWatchCmdId" => { "stringValue" => cmdId },
            "lastWatchCmdSeq" => { "integerValue" => clampInt(seqNum, 0, 999999999).toString() },
            "watchStepsCount" => { "integerValue" => clampInt(stVal, 0, 1000000).toString() },
            "watchDistanceM" => { "integerValue" => clampInt(dmVal, 0, 1000000).toString() },
            "watchCaloriesKcal" => { "integerValue" => clampInt(kcVal, 0, 100000).toString() },
            "watchSource" => { "stringValue" => "GARMIN_CIQ" },
            "watchDeviceId" => { "stringValue" => mWatchDeviceId },
            "watchHeartbeatAt" => { "integerValue" => hbEpochMsStr },
            "updatedAt" => { "integerValue" => updEpochMsStr }
        };
        if (hrVal >= 35 && hrVal <= 240) {
            docFields["watchHeartRateBpm"] = { "integerValue" => hrVal.toString() };
        }
        if (ahrVal >= 35 && ahrVal <= 240) {
            docFields["watchAvgHeartRateBpm"] = { "integerValue" => ahrVal.toString() };
        }
        if (mhrVal >= 35 && mhrVal <= 240) {
            docFields["watchMaxHeartRateBpm"] = { "integerValue" => mhrVal.toString() };
        }
        var zVec = mCalZeroVec;
        if (zVec != null && zVec.size() == 3) {
            docFields["zeroGravityVec"] = {
                "arrayValue" => {
                    "values" => [
                        { "integerValue" => clampInt(zVec[0], -100000, 100000).toString() },
                        { "integerValue" => clampInt(zVec[1], -100000, 100000).toString() },
                        { "integerValue" => clampInt(zVec[2], -100000, 100000).toString() }
                    ]
                }
            };
        }
        return docFields;
    }

    (:typecheck(false))
    function flushNextQueuedCommand() as Void {
        if (mPendingCmdQueue.size() == 0) {
            return;
        }
        if (!hasPairingCode || !isValidPairingCode(pairingCode)) {
            return;
        }
        if (mHandshakeBlockedCode.length() > 0 && mHandshakeBlockedCode.equals(pairingCode)) {
            return;
        }
        if (!isValidSessionToken(mCloudSessionToken)) {
            startPairingHandshake();
            return;
        }
        var now = System.getTimer();
        if (mPatchInFlight && now >= mPatchInFlightMs && (now - mPatchInFlightMs) < 12000) {
            return;
        }

        var head = mPendingCmdQueue[0];
        var cmdId = head["id"].toString();
        var seqNum = head["seq"].toNumber();
        var tsStr = head["ts"].toString();
        var evtType = head["t"].toString();
        var valStr = head.hasKey("v") ? head["v"].toString() : "";
        var deltaNum = head.hasKey("d") ? head["d"].toNumber() : 0;
        var scNum = head.hasKey("sc") ? head["sc"].toNumber() : totalScore;

        var isFinishSnap = evtType.equals("FINISH_SESSION_FROM_WATCH");
        var stNum = (isFinishSnap && head.hasKey("st")) ? head["st"].toNumber() : stepsCount;
        var dmNum = (isFinishSnap && head.hasKey("dm")) ? head["dm"].toNumber() : distanceWalkedM;
        var kcNum = (isFinishSnap && head.hasKey("kc")) ? head["kc"].toNumber() : activeKcal;
        var hrNum = head.hasKey("hr") ? head["hr"].toNumber() : heartRateBpm;
        var ahrNum = head.hasKey("ahr") ? head["ahr"].toNumber() : avgHeartRateBpm;
        var mhrNum = head.hasKey("mhr") ? head["mhr"].toNumber() : maxHeartRateBpm;

        var cmdFields = {
            "type" => { "stringValue" => evtType },
            "cmdId" => { "stringValue" => cmdId },
            "_cmdId" => { "stringValue" => cmdId },
            "_ts" => { "integerValue" => tsStr }
        };

        if (evtType.equals("INCREMENT_ARROW") || evtType.equals("DECREMENT_ARROW")) {
            cmdFields["delta"] = { "integerValue" => clampInt(deltaNum, -20, 20).toString() };
            cmdFields["source"] = { "stringValue" => (valStr.length() > 0) ? valStr : "watch_manual" };
            cmdFields["totalScore"] = { "integerValue" => clampInt(scNum, 0, 100000).toString() };
        } else if (evtType.equals("SCORE_INPUT")) {
            cmdFields["value"] = { "stringValue" => valStr };
            cmdFields["totalScore"] = { "integerValue" => clampInt(scNum, 0, 100000).toString() };
        } else if (evtType.equals("UNDO_ARROW")) {
            cmdFields["totalScore"] = { "integerValue" => clampInt(scNum, 0, 100000).toString() };
        } else if (evtType.equals("ANALYSIS_MANUAL_START") || evtType.equals("ANALYSIS_MANUAL_STOP")) {
            cmdFields["ts"] = { "integerValue" => tsStr };
            cmdFields["source"] = { "stringValue" => "watch_manual" };
        } else if (evtType.equals("ANALYSIS_SHOT")) {
            var safeJson = (valStr.length() > 3500) ? valStr.substring(0, 3500) : valStr;
            cmdFields["analysisShotJson"] = { "stringValue" => safeJson };
            if (hrNum >= 35 && hrNum <= 240) {
                cmdFields["heartRateBpm"] = { "integerValue" => hrNum.toString() };
            }
        } else if (evtType.equals("FINISH_SESSION_FROM_WATCH")) {
            cmdFields["totalScore"] = { "integerValue" => clampInt(scNum, 0, 100000).toString() };
            cmdFields["stepsCount"] = { "integerValue" => clampInt(stNum, 0, 1000000).toString() };
            cmdFields["distanceWalkedM"] = { "integerValue" => clampInt(dmNum, 0, 1000000).toString() };
            cmdFields["activeKcal"] = { "integerValue" => clampInt(kcNum, 0, 100000).toString() };
            if (hrNum >= 35 && hrNum <= 240) {
                cmdFields["heartRateBpm"] = { "integerValue" => hrNum.toString() };
            }
            if (ahrNum >= 35 && ahrNum <= 240) {
                cmdFields["avgHeartRateBpm"] = { "integerValue" => ahrNum.toString() };
            }
            if (mhrNum >= 35 && mhrNum <= 240) {
                cmdFields["maxHeartRateBpm"] = { "integerValue" => mhrNum.toString() };
            }
        }

        var docFields = buildTelemetryDocFields(cmdFields, cmdId, seqNum, stNum, dmNum, kcNum, hrNum, ahrNum, mhrNum);
        mPatchInFlight = true;
        mPatchInFlightMs = now;
        mInFlightCmdId = cmdId;
        sendCloudPatch(docFields);
    }

    (:typecheck(false))
    function startPairingHandshake() as Void {
        if (!hasPairingCode || !isValidPairingCode(pairingCode)) {
            return;
        }
        if (mHandshakeBlockedCode.length() > 0 && mHandshakeBlockedCode.equals(pairingCode)) {
            return;
        }
        var now = System.getTimer();
        if (mHandshakeInFlight && now >= mHandshakeStartMs && (now - mHandshakeStartMs) < 12000) {
            return;
        }
        ensureWatchDeviceId();
        mHandshakeInFlight = true;
        mHandshakeStartMs = now;
        var url =
            "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_pairings/" +
            pairingCode;
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        try {
            Communications.makeWebRequest(url, null, options, method(:onPairingGetResponse));
        } catch (ex) {
            mHandshakeInFlight = false;
            mCloudErrorState = "NO_BLE";
        }
    }

    (:typecheck(false))
    function onPairingGetResponse(responseCode, data) as Void {
        if (responseCode == 200 && data != null && (data instanceof Lang.Dictionary) && data.hasKey("fields")) {
            var fields = data["fields"];
            var tok = (fields instanceof Lang.Dictionary) ? extractFsString(fields, "sessionToken", "") : "";
            if (!isValidSessionToken(tok)) {
                mHandshakeInFlight = false;
                mCloudErrorState = "INVALID";
                mHandshakeBlockedCode = pairingCode;
                isCloudSynced = false;
                mCloudSyncOk = false;
                WatchUi.requestUpdate();
                return;
            }
            mPendingClaimToken = tok;
            ensureWatchDeviceId();
            var nowMsStr = (Time.now().value().toLong() * 1000l + (System.getTimer() % 1000)).toString();
            var claimUrl =
                "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_pairings/" +
                pairingCode +
                "?updateMask.fieldPaths=claimed&updateMask.fieldPaths=watchDeviceId&updateMask.fieldPaths=watchSource&updateMask.fieldPaths=updatedAt&currentDocument.exists=true";
            var claimFields = {
                "claimed" => { "booleanValue" => true },
                "watchDeviceId" => { "stringValue" => mWatchDeviceId },
                "watchSource" => { "stringValue" => "GARMIN_CIQ" },
                "updatedAt" => { "integerValue" => nowMsStr }
            };
            var options = {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => {
                    "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                    "X-HTTP-Method-Override" => "PATCH"
                },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            };
            try {
                Communications.makeWebRequest(claimUrl, { "fields" => claimFields }, options, method(:onPairingClaimResponse));
            } catch (ex) {
                mHandshakeInFlight = false;
                mPendingClaimToken = "";
                mCloudErrorState = "NO_BLE";
                WatchUi.requestUpdate();
            }
            return;
        }

        mHandshakeInFlight = false;
        isCloudSynced = false;
        mCloudSyncOk = false;
        if (responseCode == 403 || responseCode == 401) {
            mCloudErrorState = "EXPIRED";
            mHandshakeBlockedCode = pairingCode;
        } else if (responseCode == 404) {
            mCloudErrorState = "INVALID";
            mHandshakeBlockedCode = pairingCode;
        } else {
            mCloudErrorState = "NO_BLE";
        }
        WatchUi.requestUpdate();
    }

    (:typecheck(false))
    function onPairingClaimResponse(responseCode, data) as Void {
        mHandshakeInFlight = false;
        if (responseCode == 200 && isValidSessionToken(mPendingClaimToken)) {
            mCloudSessionToken = mPendingClaimToken;
            mPendingClaimToken = "";
            mCloudErrorState = "";
            mHandshakeBlockedCode = "";
            isCloudSynced = true;
            mCloudSyncOk = true;
            saveStateToStorage();
            if (mPendingCmdQueue.size() > 0) {
                flushNextQueuedCommand();
            } else {
                pollFirestoreCloud();
                sendTelemetryPing();
            }
            WatchUi.requestUpdate();
            return;
        }

        mPendingClaimToken = "";
        isCloudSynced = false;
        mCloudSyncOk = false;
        if (responseCode == 403 || responseCode == 401) {
            mCloudErrorState = "EXPIRED";
            mHandshakeBlockedCode = pairingCode;
        } else if (responseCode == 404) {
            mCloudErrorState = "INVALID";
            mHandshakeBlockedCode = pairingCode;
        } else {
            mCloudErrorState = "NO_BLE";
        }
        WatchUi.requestUpdate();
    }

    (:typecheck(false))
    function sendCloudPatch(docFields as Lang.Dictionary) as Void {
        if (!isValidSessionToken(mCloudSessionToken) || docFields == null) {
            mPatchInFlight = false;
            return;
        }
        var allowedKeys = [
            "lastWatchCmd", "lastWatchCmdId", "lastWatchCmdSeq",
            "watchStepsCount", "watchDistanceM", "watchCaloriesKcal",
            "watchHeartRateBpm", "watchAvgHeartRateBpm", "watchMaxHeartRateBpm",
            "watchHeartbeatAt", "calibrateZeroAt", "zeroGravityVec",
            "watchSource", "watchDeviceId", "updatedAt"
        ] as Lang.Array<Lang.String>;

        var maskQuery = "";
        for (var i = 0; i < allowedKeys.size(); i++) {
            var key = allowedKeys[i];
            if (docFields.hasKey(key)) {
                maskQuery = maskQuery + ((maskQuery.length() == 0) ? "?" : "&") + "updateMask.fieldPaths=" + key;
            }
        }
        maskQuery = maskQuery + "&currentDocument.exists=true";

        var url =
            "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/" +
            mCloudSessionToken +
            maskQuery;

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
        } catch (ex) {
            mPatchInFlight = false;
            mInFlightCmdId = "";
            mCloudErrorState = "NO_BLE";
        }
    }

    (:typecheck(false))
    function handleCloudSessionExpiredOrInvalid(responseCode as Lang.Number) as Void {
        mPatchInFlight = false;
        mInFlightCmdId = "";
        mCloudSessionToken = "";
        mCloudSyncOk = false;
        isCloudSynced = false;
        mCloudErrorState = (responseCode == 404) ? "INVALID" : "EXPIRED";
        mHandshakeBlockedCode = pairingCode;
        saveStateToStorage();
        WatchUi.requestUpdate();
    }

    (:typecheck(false))
    function onCloudPatchResponse(responseCode, data) as Void {
        mPatchInFlight = false;
        if (responseCode == 200) {
            if (mInFlightCmdId.length() > 0 && mPendingCmdQueue.size() > 0) {
                var headId = mPendingCmdQueue[0]["id"].toString();
                if (headId.equals(mInFlightCmdId)) {
                    mPendingCmdQueue = mPendingCmdQueue.slice(1, mPendingCmdQueue.size()) as Lang.Array<Lang.Dictionary>;
                    saveQueueToStorage();
                }
            }
            mInFlightCmdId = "";
            mCloudErrorState = "";
            mCloudSyncOk = true;
            if (!isCloudSynced) {
                isCloudSynced = true;
            }
            if (mPendingCmdQueue.size() > 0) {
                flushNextQueuedCommand();
            }
            WatchUi.requestUpdate();
            return;
        }

        mInFlightCmdId = "";
        if (responseCode == 401 || responseCode == 403 || responseCode == 404) {
            handleCloudSessionExpiredOrInvalid(responseCode);
            return;
        }

        if (responseCode < 0) {
            mCloudErrorState = "NO_BLE";
        }
        if (isCloudSynced && responseCode != -101) {
            mCloudSyncOk = false;
            isCloudSynced = false;
        }
        WatchUi.requestUpdate();
    }

    (:typecheck(false))
    function pollFirestoreCloud() as Void {
        if (!hasPairingCode || !isValidPairingCode(pairingCode)) {
            return;
        }
        if (mHandshakeBlockedCode.length() > 0 && mHandshakeBlockedCode.equals(pairingCode)) {
            return;
        }
        if (!isValidSessionToken(mCloudSessionToken)) {
            startPairingHandshake();
            return;
        }
        if (mPendingCmdQueue.size() > 0) {
            flushNextQueuedCommand();
            return;
        }

        var maskParams =
            "?mask.fieldPaths=sessionId" +
            "&mask.fieldPaths=sessionActive" +
            "&mask.fieldPaths=analysisMode" +
            "&mask.fieldPaths=analysisCalibrationJson" +
            "&mask.fieldPaths=arrowsCount" +
            "&mask.fieldPaths=totalScore" +
            "&mask.fieldPaths=roundScoreMax" +
            "&mask.fieldPaths=currentEnd" +
            "&mask.fieldPaths=totalEnds" +
            "&mask.fieldPaths=arrowsPerEnd" +
            "&mask.fieldPaths=distanceM" +
            "&mask.fieldPaths=gpsActive" +
            "&mask.fieldPaths=currentEndArrows" +
            "&mask.fieldPaths=lastWatchCmdId" +
            "&mask.fieldPaths=calibrateZeroAt" +
            "&mask.fieldPaths=zeroGravityVec" +
            "&mask.fieldPaths=bowPoundageLbs" +
            "&mask.fieldPaths=bowType" +
            "&mask.fieldPaths=autoDetectEnabled" +
            "&mask.fieldPaths=updatedAt";

        var url =
            "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/" +
            mCloudSessionToken +
            maskParams;

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        try {
            Communications.makeWebRequest(url, null, options, method(:onCloudPollResponse));
        } catch (ex) {
            mCloudErrorState = "NO_BLE";
        }
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
    function extractFsLong(fields, key as Lang.String, fallback as Lang.Long) as Lang.Long {
        if (!fields.hasKey(key) || fields[key] == null) {
            return fallback;
        }
        var node = fields[key];
        if (!(node instanceof Lang.Dictionary)) {
            return fallback;
        }
        if (node.hasKey("integerValue") && node["integerValue"] != null) {
            var s = node["integerValue"].toString();
            var parsed = parsePositiveLongFromChars(s, 0);
            return (parsed != null) ? parsed : fallback;
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

    function parsePositiveLongFromChars(str as Lang.String, startIdx as Lang.Number) as Lang.Long? {
        var chars = str.toCharArray();
        var n = chars.size();
        var i = startIdx;
        while (i < n) {
            var ch = chars[i].toNumber();
            if (ch == 32 || ch == 58) {
                i = i + 1;
            } else {
                break;
            }
        }
        var digits = 0;
        var acc = 0l;
        while (i < n) {
            var d = chars[i].toNumber();
            if (d >= 48 && d <= 57) {
                acc = (acc * 10l) + (d - 48).toLong();
                digits = digits + 1;
                i = i + 1;
            } else {
                break;
            }
        }
        return (digits > 0) ? acc : null;
    }

    function extractJsonLong(jsonStr as Lang.String, keyPattern as Lang.String) as Lang.Long? {
        var idx = jsonStr.find(keyPattern);
        if (idx == null) {
            return null;
        }
        return parsePositiveLongFromChars(jsonStr, idx + keyPattern.length());
    }

    (:typecheck(false))
    function onCloudPollResponse(responseCode, data) as Void {
        if (responseCode == 401 || responseCode == 403 || responseCode == 404) {
            handleCloudSessionExpiredOrInvalid(responseCode);
            return;
        }
        if (responseCode < 0) {
            mCloudErrorState = "NO_BLE";
            if (isCloudSynced || mCloudSyncOk) {
                mCloudSyncOk = false;
                isCloudSynced = false;
                WatchUi.requestUpdate();
            }
            return;
        }
        if (responseCode == 200 && data != null && (data instanceof Lang.Dictionary)) {
            mCloudErrorState = "";
            mCloudSyncOk = true;
            isCloudSynced = true;
            if (!data.hasKey("fields")) {
                WatchUi.requestUpdate();
                return;
            }
            var fields = data["fields"];
            if (!(fields instanceof Lang.Dictionary)) {
                return;
            }

            var sessionActive = extractFsBool(fields, "sessionActive", true);
            var incomingSid = extractFsString(fields, "sessionId", "");
            var fsArrows = extractFsInt(fields, "arrowsCount", arrowsCount);
            var fsScore = extractFsInt(fields, "totalScore", totalScore);
            var fsRoundMax = extractFsInt(fields, "roundScoreMax", roundScoreMax);
            var fsEnd = extractFsInt(fields, "currentEnd", currentEnd);
            var fsDistM = extractFsInt(fields, "distanceM", distanceM);
            var fsGpsActive = extractFsBool(fields, "gpsActive", mRemoteGpsActive);
            var fsPerEnd = extractFsInt(fields, "arrowsPerEnd", arrowsPerEnd);
            var fsTotalEnds = extractFsInt(fields, "totalEnds", endsCount);
            var fsAnalysis = extractFsBool(fields, "analysisMode", analysisMode);
            var fsAutoDetect = extractFsBool(fields, "autoDetectEnabled", autoDetectEnabled);
            var fsBow = extractFsString(fields, "bowType", bowTypeStr);
            var fsCalJson = extractFsString(fields, "analysisCalibrationJson", "");
            var cloudLastCmdId = extractFsString(fields, "lastWatchCmdId", "");
            var calZeroTs = extractFsLong(fields, "calibrateZeroAt", 0l);
            var fsUpdatedAt = extractFsLong(fields, "updatedAt", 0l);

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

            var remoteSig = (sessionActive ? "1|" : "0|") + incomingSid + "|" +
                fsArrows.toString() + "|" + fsScore.toString() + "|" + fsEnd.toString() + "|" +
                endArrowsJoined + "|" + fsDistM.toString() + "|" + fsPerEnd.toString() + "|" +
                fsTotalEnds.toString() + "|" + (fsAnalysis ? "1" : "0");
            if (mLastRemoteStateSig.length() == 0) {
                mLastRemoteStateSig = remoteSig;
            } else if (!remoteSig.equals(mLastRemoteStateSig)) {
                mLastRemoteStateSig = remoteSig;
                mLastActivityMs = System.getTimer();
            }

            var nowTimer = System.getTimer();
            var elapsedSinceLocal = (nowTimer >= mLastLocalActionMs) ? (nowTimer - mLastLocalActionMs) : 999999;

            if (!sessionActive) {
                if (analysisMode) {
                    analysisMode = false;
                    manualAnalysisRecording = false;
                    manualAnalysisStartTimerMs = 0;
                    syncHighFreqAccelerometer();
                }
                if (mPendingCmdQueue.size() == 0 && !mAwaitingPhoneSync && (mLastLocalActionMs == 0 || elapsedSinceLocal > 6000)) {
                    if (arrowsCount > 0 || totalScore > 0 || stepsCount > 0 || distanceWalkedM > 0) {
                        resetAllCounters("");
                    }
                }
                WatchUi.requestUpdate();
                return;
            }

            if (mPendingCmdQueue.size() > 0) {
                flushNextQueuedCommand();
                return;
            }

            var switchedToNewSession = (incomingSid.length() > 0 && currentSessionId.length() > 0 && !incomingSid.equals(currentSessionId));
            if (switchedToNewSession) {
                mAwaitingPhoneSync = false;
                mLatestEnqueuedCmdId = "";
                resetAllCounters(incomingSid);
            } else if (incomingSid.length() > 0) {
                currentSessionId = incomingSid;
            }

            // AUD-GAR-01: Never overwrite local arrow/score state while queue has items OR until cloud catches up to latest command
            var cmdIdMatched = (mLatestEnqueuedCmdId.length() == 0) || cloudLastCmdId.equals(mLatestEnqueuedCmdId);
            if (mAwaitingPhoneSync && cmdIdMatched) {
                if ((fsArrows == arrowsCount && fsScore == totalScore && fsEnd == currentEnd) || fsArrows > arrowsCount) {
                    mAwaitingPhoneSync = false;
                }
            }

            var recentlyTapped = (nowTimer >= mLastLocalActionMs) && (elapsedSinceLocal < 3500);
            if (!recentlyTapped && cmdIdMatched && !mAwaitingPhoneSync) {
                arrowsCount = fsArrows;
                totalScore = fsScore;
                currentEnd = fsEnd;
                if (hasEndArrowsField) {
                    currentEndArrows = parsedEndArrows;
                }
            }

            roundScoreMax = fsRoundMax;
            distanceM = fsDistM;
            mRemoteGpsActive = fsGpsActive;
            arrowsPerEnd = fsPerEnd;
            endsCount = fsTotalEnds;
            if (fsBow.length() > 0) {
                bowTypeStr = fsBow;
            }
            if (fsCalJson.find("\"bowWrist\":\"RIGHT\"") != null) {
                bowWristStr = "RIGHT";
            } else if (fsCalJson.find("\"bowWrist\":\"LEFT\"") != null) {
                bowWristStr = "LEFT";
            }
            bowPoundageLbs = extractFsInt(fields, "bowPoundageLbs", bowPoundageLbs);

            autoDetectEnabled = fsAutoDetect;
            if (fsAnalysis != analysisMode) {
                analysisMode = fsAnalysis;
                if (!analysisMode) {
                    manualAnalysisRecording = false;
                    manualAnalysisStartTimerMs = 0;
                    mAutoQuietMs = 0;
                    mAutoPendingMs = 0;
                }
            }

            // Optional zero-gravity reference calibration from phone
            if (calZeroTs > 0l && calZeroTs > mLastCalibrateZeroTs) {
                mLastCalibrateZeroTs = calZeroTs;
                mCalZeroVec = [
                    mLastSampleAx.toNumber(),
                    mLastSampleAy.toNumber(),
                    mLastSampleAz.toNumber()
                ] as Lang.Array<Lang.Number>;
                sendTelemetryPing();
            }

            // AUD-GAR-03 + v2.167 Cloud Latency Compensation: rewind ring-buffer window by exact phone-to-watch poll lag
            if (analysisMode && fsCalJson.length() > 0) {
                var reqStart = extractJsonLong(fsCalJson, "\"manualStartAt\":");
                var reqStop = extractJsonLong(fsCalJson, "\"manualStopAt\":");
                var nowEpochMs = Time.now().value().toLong() * 1000l + (nowTimer % 1000);
                if (reqStart != null && reqStart > 0l && reqStart > mLastRemoteStartTs && (reqStop == null || reqStop < reqStart)) {
                    mLastRemoteStartTs = reqStart;
                    var startDiff = nowEpochMs - reqStart;
                    var startLagMs = 450;
                    if (startDiff >= 0l && startDiff <= 12000l) {
                        startLagMs = startDiff.toNumber();
                    } else if (fsUpdatedAt > reqStart && (fsUpdatedAt - reqStart) <= 12000l) {
                        startLagMs = (fsUpdatedAt - reqStart).toNumber() + 450;
                    }
                    startManualAnalysisWithLag(false, startLagMs);
                }
                if (reqStop != null && reqStop > 0l && reqStop > mLastRemoteStopTs && (reqStart == null || reqStop >= reqStart)) {
                    mLastRemoteStopTs = reqStop;
                    if (manualAnalysisRecording) {
                        var stopDiff = nowEpochMs - reqStop;
                        var stopLagMs = 450;
                        if (stopDiff >= 0l && stopDiff <= 9000l) {
                            stopLagMs = stopDiff.toNumber();
                        } else if (fsUpdatedAt > reqStop && (fsUpdatedAt - reqStop) <= 9000l) {
                            stopLagMs = (fsUpdatedAt - reqStop).toNumber() + 450;
                        }
                        stopManualAnalysisWithLag(false, stopLagMs);
                    }
                }
            }

            syncHighFreqAccelerometer();
            syncGpsTrackingState();
            saveStateToStorage();
            WatchUi.requestUpdate();
        }
    }

    // =========================================================================
    // Crisp Matte OLED & 1-Bit Monochrome UI Renderer (All 53 Garmin Models)
    // =========================================================================

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
    function drawArchery101010Header(
        dc as Graphics.Dc,
        w as Lang.Number,
        h as Lang.Number,
        s as Lang.Float,
        statusLabel as Lang.String,
        compact as Lang.Boolean,
        isMono as Lang.Boolean
    ) as Void {
        var strokePx = (w >= 340) ? 2 : 1;
        var fMicro = (mFontMicro != null) ? mFontMicro : Graphics.FONT_XTINY;

        // Instinct 2 / 2S / 2X physical circular subscreen sits at top-right (x >= w - 62, y < 62)
        var safeTopRightX = isMono ? (w - 63) : w;
        var leftPad = isMono ? 6 : 12;
        var topCx = isMono ? ((leftPad + safeTopRightX) / 2) : (w / 2);

        var logoTopY = isMono ? 6 : ((compact ? 19.0 : 22.0) * s).toNumber();
        var logoBottomY = logoTopY + (isMono ? 11 : (12.0 * s).toNumber());
        var logoRes = mBrandLogo;
        if (logoRes != null) {
            var lw = logoRes.getWidth();
            var lh = logoRes.getHeight();
            var lx = topCx - (lw / 2);
            if (isMono && (lx + lw) > safeTopRightX) {
                lx = safeTopRightX - lw;
            }
            if (lx < 4) { lx = 4; }
            dc.drawBitmap(lx, logoTopY, logoRes);
            logoBottomY = logoTopY + lh;
        } else {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(topCx, logoTopY + 5, fMicro, "ARCHERY 101010", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        var pillY = logoBottomY + (isMono ? 3 : ((compact ? 4.0 : 6.0) * s).toNumber());
        var fontH = dc.getFontHeight(fMicro);
        var minPillH = isMono ? 15 : ((compact ? 15.0 : 17.0) * s).toNumber();
        var pillH = fontH + (isMono ? 2 : (1.0 * s).toNumber());
        if (pillH < minPillH) {
            pillH = minPillH;
        }

        var maxPillW = isMono ? (safeTopRightX - leftPad) : ((compact ? 162.0 : 176.0) * s).toNumber();
        var minPillW = isMono ? 64 : ((compact ? 96.0 : 112.0) * s).toNumber();
        var dispLbl = statusLabel;
        var textW = dc.getTextWidthInPixels(dispLbl, fMicro);
        var pillW = textW + (isMono ? 10 : (20.0 * s).toNumber());
        if (pillW < minPillW) { pillW = minPillW; }
        if (pillW > maxPillW) { pillW = maxPillW; }
        var pillX = topCx - (pillW / 2);
        if (isMono && (pillX + pillW) > safeTopRightX) {
            pillX = safeTopRightX - pillW;
        }
        if (pillX < 4) { pillX = 4; }

        var isYellow = (dispLbl.find("EDIT") != null)
            || (dispLbl.find("ENVIADO") != null)
            || (dispLbl.find("SAVED") != null)
            || (dispLbl.find("CONFIRMAR") != null)
            || (dispLbl.find("CONFIRM") != null)
            || (dispLbl.find("ATRÁS") != null)
            || (dispLbl.find("BACK") != null);
        var isDanger = (dispLbl.find("EXPIRADO") != null)
            || (dispLbl.find("EXPIRED") != null)
            || (dispLbl.find("INVÁLIDO") != null)
            || (dispLbl.find("INVALID") != null)
            || (dispLbl.find("VINCULA") != null);
        var isMuted = (dispLbl.find("MANUAL") != null)
            || (dispLbl.find("SIN ") != null)
            || (dispLbl.find("NO ") != null)
            || (dispLbl.find("TOCA") != null)
            || (dispLbl.find("PULSA") != null)
            || (dispLbl.find("TAP") != null)
            || (dispLbl.find("PRESS") != null);

        var fillCol = isMono
            ? ((isYellow || isDanger) ? 0xFFFFFF : 0x000000)
            : (isDanger ? 0x220709 : (isYellow ? 0x121106 : (isMuted ? 0x0A0D13 : 0x050D17)));
        var borderCol = isMono
            ? 0xFFFFFF
            : (isDanger ? 0xFF1E1E : (isYellow ? 0xFFE500 : (isMuted ? 0x475569 : 0x00A8F3)));
        var txtCol = (isMono && (isYellow || isDanger)) ? 0x000000 : Graphics.COLOR_WHITE;

        drawCrispBox(dc, pillX, pillY, pillW, pillH, pillH / 2, fillCol, borderCol, strokePx);
        dc.setColor(txtCol, Graphics.COLOR_TRANSPARENT);
        dc.drawText(pillX + (pillW / 2), pillY + (pillH / 2), fMicro, dispLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function drawPagerDots(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number, s as Lang.Float, isMono as Lang.Boolean) as Void {
        var cx = w / 2;
        var dotY = isMono ? (h - 6) : (h - (15.0 * s).toNumber());
        var activeW = isMono ? 10 : (11.0 * s).toNumber();
        var inactiveW = isMono ? 4 : (4.0 * s).toNumber();
        var dotH = isMono ? 4 : (4.0 * s).toNumber();
        var gap = isMono ? 4 : (4.0 * s).toNumber();
        var totalW = activeW + (4 * inactiveW) + (4 * gap);
        var curX = cx - (totalW / 2);

        for (var i = 0; i < 5; i++) {
            var itemW = (i == screenIdx) ? activeW : inactiveW;
            if (isMono) {
                dc.setColor(0xFFFFFF, Graphics.COLOR_TRANSPARENT);
                if (i == screenIdx) {
                    dc.fillRectangle(curX, dotY - (dotH / 2), itemW, dotH);
                } else {
                    dc.drawRectangle(curX, dotY - (dotH / 2), itemW, dotH);
                }
            } else {
                dc.setColor((i == screenIdx) ? 0x00A8F3 : 0x334155, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(curX, dotY - (dotH / 2), itemW, dotH, dotH / 2);
            }
            curX = curX + itemW + gap;
        }
    }

    (:typecheck(false))
    function onUpdate(dc as Graphics.Dc) as Void {
        recalculateMetrics();
        var now = System.getTimer();
        var w = dc.getWidth();
        var h = dc.getHeight();
        lastScreenWidth = w;
        lastScreenHeight = h;
        var minDim = (w < h) ? w : h;
        var isMono = (w <= 180 || h <= 180);
        var isCompactMono = (h <= 160);
        var s = minDim / 240.0;
        var cx = w / 2;
        var strokePx = (w >= 340) ? 2 : 1;
        var isConnectedNow = (isCloudSynced || isBleConnected);

        var fMicro = (mFontMicro != null) ? mFontMicro : Graphics.FONT_XTINY;
        var fLabel = (mFontLabel != null) ? mFontLabel : Graphics.FONT_XTINY;
        var fValue = (mFontValue != null) ? mFontValue : Graphics.FONT_SMALL;
        var fHero = (mFontHero != null) ? mFontHero : Graphics.FONT_NUMBER_MEDIUM;

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var mts = distanceWalkedM;
        var walkedPrimaryStr = formatWalkedPrimary(mts);
        var walkedDualStr = formatWalkedDual(mts);
        var maxPillTxtW = isMono ? (w - 76) : (152.0 * s).toNumber();
        var exitArmed = (mConfirmExitUntilMs > 0 && now < mConfirmExitUntilMs);

        if (screenIdx == 0 && analysisMode) {
            var elapsedSec = manualAnalysisRecording
                ? ((now - manualAnalysisStartTimerMs) / 1000)
                : 0;
            if (elapsedSec < 0) { elapsedSec = 0; }
            var anaPill = exitArmed
                ? tr("ATRÁS: SALIR", "BACK: EXIT")
                : (manualAnalysisRecording
                    ? (tr("GRABANDO · ", "REC · ") + elapsedSec.toString() + "S")
                    : ((arrowsCount > 0)
                        ? (tr("TIRO ", "SHOT ") + arrowsCount.toString() + " · " + distanceM.toString() + "M")
                        : (tr("ANÁLISIS · ", "ANALYSIS · ") + distanceM.toString() + "M")));
            if (dc.getTextWidthInPixels(anaPill, fMicro) > maxPillTxtW) {
                anaPill = exitArmed ? tr("SALIR", "EXIT") : (manualAnalysisRecording ? "REC" : tr("ANÁLISIS", "ANALYSIS"));
            }
            drawArchery101010Header(dc, w, h, s, anaPill, !manualAnalysisRecording, isMono);

            var statBoxW = isMono ? (w - 14) : (160.0 * s).toNumber();
            var statBoxH = isMono ? (isCompactMono ? 34 : 38) : (48.0 * s).toNumber();
            var statBoxX = cx - (statBoxW / 2);
            var statBoxY = isMono ? 62 : (60.0 * s).toNumber();
            var statFill = isMono
                ? (manualAnalysisRecording ? 0xFFFFFF : 0x000000)
                : (manualAnalysisRecording ? 0x151105 : 0x0B0E15);
            var statBorder = isMono ? 0xFFFFFF : (manualAnalysisRecording ? 0xFFE500 : 0x00A8F3);
            var statTxtCol = isMono
                ? (manualAnalysisRecording ? 0x000000 : 0xFFFFFF)
                : (manualAnalysisRecording ? 0xFFE500 : Graphics.COLOR_WHITE);

            drawCrispBox(dc, statBoxX, statBoxY, statBoxW, statBoxH, isMono ? 5 : (8.0 * s).toNumber(), statFill, statBorder, strokePx);
            var centerTitle = manualAnalysisRecording
                ? (tr("EN CURSO · ", "ACTIVE · ") + elapsedSec.toString() + " s")
                : ((lastAnalysisStabPct > 0)
                    ? (tr("ESTAB. ", "STAB. ") + lastAnalysisStabPct.toString() + "%")
                    : tr("LISTO · BOTÓN", "READY · BUTTON"));
            var statFont = pickFittingFont(dc, centerTitle, statBoxW - 10, fValue, fLabel, fMicro);
            dc.setColor(statTxtCol, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, statBoxY + (statBoxH / 2), statFont, centerTitle, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var aRowY = isMono ? (statBoxY + statBoxH + 5) : (118.0 * s).toNumber();
            var aRowW = statBoxW;
            var aGap = isMono ? 5 : (7.0 * s).toNumber();
            var aBtnW = (aRowW - aGap) / 2;
            var aBtnH = isMono ? (isCompactMono ? 25 : 28) : (36.0 * s).toNumber();
            var aRad = isMono ? 5 : (10.0 * s).toNumber();

            var startBtnX = cx - (aRowW / 2);
            var startInv = isMono && !manualAnalysisRecording;
            drawCrispBox(
                dc,
                startBtnX,
                aRowY,
                aBtnW,
                aBtnH,
                aRad,
                isMono ? (startInv ? 0xFFFFFF : 0x000000) : (manualAnalysisRecording ? 0x09131E : 0x061523),
                isMono ? 0xFFFFFF : 0x00A8F3,
                strokePx
            );
            dc.setColor(isMono ? (startInv ? 0x000000 : 0xFFFFFF) : (manualAnalysisRecording ? 0x94A3B8 : 0x00BFFF), Graphics.COLOR_TRANSPARENT);
            dc.drawText(startBtnX + (aBtnW / 2), aRowY + (aBtnH / 2), fMicro, tr("INICIO", "START"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var stopBtnX = cx + (aRowW / 2) - aBtnW;
            var stopInv = isMono && manualAnalysisRecording;
            drawCrispBox(
                dc,
                stopBtnX,
                aRowY,
                aBtnW,
                aBtnH,
                aRad,
                isMono ? (stopInv ? 0xFFFFFF : 0x000000) : (manualAnalysisRecording ? 0x260709 : 0x0E121B),
                isMono ? 0xFFFFFF : (manualAnalysisRecording ? 0xFF1E1E : 0x334155),
                strokePx
            );
            dc.setColor(isMono ? (stopInv ? 0x000000 : 0xFFFFFF) : (manualAnalysisRecording ? Graphics.COLOR_WHITE : 0x64748B), Graphics.COLOR_TRANSPARENT);
            dc.drawText(stopBtnX + (aBtnW / 2), aRowY + (aBtnH / 2), fMicro, tr("FINAL", "END"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            if (!isMono) {
                dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, (172.0 * s).toNumber(), fMicro, tr("BOTÓN ARRIBA-DER: INICIO/FINAL", "TOP-RIGHT BTN: START/END"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }
        } else if (screenIdx == 0) {
            var qCount = mPendingCmdQueue.size();
            var pillTxt = exitArmed
                ? tr("ATRÁS OTRA VEZ", "PRESS BACK AGAIN")
                : (isConnectedNow
                    ? ((qCount > 0) ? ("SYNC · " + qCount.toString()) : tr("CONECTADO · LIVE", "SYNCED · LIVE"))
                    : ((qCount > 0) ? (tr("COLA · ", "QUEUE · ") + qCount.toString()) : tr("MODO MANUAL", "MANUAL MODE")));
            if (dc.getTextWidthInPixels(pillTxt, fMicro) > maxPillTxtW) {
                pillTxt = exitArmed
                    ? tr("ATRÁS: SALIR", "BACK: EXIT")
                    : (isConnectedNow ? "LIVE" : "MANUAL");
            }
            drawArchery101010Header(dc, w, h, s, pillTxt, true, isMono);

            var d3 = (arrowsCount / 1000) % 10;
            var d2 = (arrowsCount / 100) % 10;
            var d1 = (arrowsCount / 10) % 10;
            var d0 = arrowsCount % 10;
            var digits = [d3, d2, d1, d0] as Lang.Array<Lang.Number>;

            var boxW = isMono ? (isCompactMono ? 34 : 36) : (37.0 * s).toNumber();
            var boxH = isMono ? (isCompactMono ? 34 : 38) : (50.0 * s).toNumber();
            var gap = isMono ? 4 : (5.0 * s).toNumber();
            var totalW = (boxW * 4) + (gap * 3);
            var startX = cx - (totalW / 2);
            var startY = isMono ? 62 : (60.0 * s).toNumber();

            for (var i = 0; i < 4; i++) {
                var rx = startX + i * (boxW + gap);
                var cellFill = isMono ? 0x000000 : ((i == 3) ? 0x121107 : 0x0B0E15);
                var cellBorder = isMono ? 0xFFFFFF : ((i == 3) ? 0xFFE500 : 0x3E4756);
                drawCrispBox(dc, rx, startY, boxW, boxH, isMono ? 4 : (7.0 * s).toNumber(), cellFill, cellBorder, (isMono && i == 3) ? 2 : strokePx);

                dc.setColor(isMono ? 0xFFFFFF : ((i == 3) ? 0xFFE500 : Graphics.COLOR_WHITE), Graphics.COLOR_TRANSPARENT);
                dc.drawText(rx + (boxW / 2), startY + (boxH / 2), fHero, digits[i].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            var rowY = isMono ? (startY + boxH + 4) : (118.0 * s).toNumber();
            var rowW = totalW;
            var btnGap = isMono ? 5 : (7.0 * s).toNumber();
            var btnW = (rowW - btnGap) / 2;
            var btnH = isMono ? (isCompactMono ? 23 : 26) : (36.0 * s).toNumber();
            var btnRad = isMono ? 5 : (10.0 * s).toNumber();

            var minusX = cx - (rowW / 2);
            drawCrispBox(dc, minusX, rowY, btnW, btnH, btnRad, isMono ? 0x000000 : 0x180709, isMono ? 0xFFFFFF : 0xFF1E1E, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(minusX + (btnW / 2), rowY + (btnH / 2), fValue, "-1", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var plusX = cx + (rowW / 2) - btnW;
            drawCrispBox(dc, plusX, rowY, btnW, btnH, btnRad, isMono ? 0xFFFFFF : 0x061523, isMono ? 0xFFFFFF : 0x00A8F3, strokePx);
            dc.setColor(isMono ? 0x000000 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(plusX + (btnW / 2), rowY + (btnH / 2), fValue, "+1", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var telemStr = walkedPrimaryStr + " · " + activeKcal.toString() + " kcal";
            var telemY = isMono ? (rowY + btnH + (isCompactMono ? 9 : 11)) : (168.0 * s).toNumber();
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, telemY, fMicro, telemStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            if (!isMono) {
                var endDistStr = tr("TANDA ", "END ") + currentEnd.toString() + " · " + distanceM.toString() + " M";
                dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, (186.0 * s).toNumber(), fMicro, endDistStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

        } else if (screenIdx == 1) {
            // SCREEN 1: XL 4x3 Score Keypad + Full 5-Button Cursor Navigation (0..11 keys, 12 BORRAR, 13 SIG. TANDA)
            var microH = dc.getFontHeight(fMicro);
            var slotCount = (arrowsPerEnd < 6) ? arrowsPerEnd : 6;
            if (slotCount < 1) { slotCount = 6; }
            var endTagPrefix = tr("T", "E");
            var ptsStr = isPadCursorActive
                ? ("< " + endTagPrefix + currentEnd.toString() + "·" + totalScore.toString() + " >")
                : ((!isTouchScreen && currentEndArrows.size() == 0)
                    ? ("OK·" + endTagPrefix + currentEnd.toString() + "·" + totalScore.toString())
                    : (endTagPrefix + currentEnd.toString() + "·" + totalScore.toString() + "P"));

            var kStartY = 0;
            if (isMono) {
                // Instinct 2 / 2S / 2X: keep top header + 6 arrow slots strictly left of top-right subscreen (x < w - 62 in y < 62)
                var safeRight = w - 63;
                var leftX = 5;
                var topAvailW = safeRight - leftX;
                var topCenter = leftX + (topAvailW / 2);

                var logoRes1 = mBrandLogo;
                var logoBot1 = 16;
                if (logoRes1 != null) {
                    var lw1 = logoRes1.getWidth();
                    var lh1 = logoRes1.getHeight();
                    var lx1 = topCenter - (lw1 / 2);
                    if ((lx1 + lw1) > safeRight) { lx1 = safeRight - lw1; }
                    if (lx1 < 4) { lx1 = 4; }
                    dc.drawBitmap(lx1, 5, logoRes1);
                    logoBot1 = 5 + lh1;
                }

                var tagY = logoBot1 + 2;
                var tagH = 15;
                var tagW = dc.getTextWidthInPixels(ptsStr, fMicro) + 8;
                if (tagW > topAvailW) { tagW = topAvailW; }
                var tagX = topCenter - (tagW / 2);
                drawCrispBox(dc, tagX, tagY, tagW, tagH, 4, isPadCursorActive ? 0xFFFFFF : 0x000000, 0xFFFFFF, 1);
                dc.setColor(isPadCursorActive ? 0x000000 : 0xFFFFFF, Graphics.COLOR_TRANSPARENT);
                dc.drawText(tagX + (tagW / 2), tagY + (tagH / 2), fMicro, ptsStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

                var mSlotGap = 2;
                var mSlotW = (topAvailW - ((slotCount - 1) * mSlotGap)) / slotCount;
                if (mSlotW > 14) { mSlotW = 14; }
                if (mSlotW < 10) { mSlotW = 10; }
                var mSlotsTotal = (slotCount * mSlotW) + ((slotCount - 1) * mSlotGap);
                var mSlotStartX = topCenter - (mSlotsTotal / 2);
                var mSlotY = tagY + tagH + 2;
                var mSlotH = 15;
                for (var msi = 0; msi < slotCount; msi++) {
                    var msx = mSlotStartX + msi * (mSlotW + mSlotGap);
                    var mHasVal = (msi < currentEndArrows.size());
                    var msVal = mHasVal ? currentEndArrows[msi] : "-";
                    drawCrispBox(dc, msx, mSlotY, mSlotW, mSlotH, 2, 0x000000, 0xFFFFFF, 1);
                    dc.setColor(0xFFFFFF, Graphics.COLOR_TRANSPARENT);
                    dc.drawText(msx + (mSlotW / 2), mSlotY + (mSlotH / 2), fMicro, msVal, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                }
                kStartY = 62;
            } else {
                var logoTopY = (19.0 * s).toNumber();
                var logoBottomY = logoTopY + (11.0 * s).toNumber();
                var logoResC = mBrandLogo;
                if (logoResC != null) {
                    var lw = logoResC.getWidth();
                    var lh = logoResC.getHeight();
                    dc.drawBitmap(cx - (lw / 2), logoTopY, logoResC);
                    logoBottomY = logoTopY + lh;
                } else {
                    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                    dc.drawText(cx, logoTopY + (5.0 * s).toNumber(), fMicro, "ARCHERY 101010", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                }

                var barY = logoBottomY + (3.5 * s).toNumber();
                var barH = (16.5 * s).toNumber();
                if (barH < (microH + 2)) {
                    barH = microH + 2;
                }

                var maxBarW = (158.0 * s).toNumber();
                var ptsTextW = dc.getTextWidthInPixels(ptsStr, fMicro);
                var ptsTagW = ptsTextW + (9.0 * s).toNumber();
                var maxPtsTagW = (68.0 * s).toNumber();
                if (ptsTagW > maxPtsTagW) {
                    ptsStr = endTagPrefix + currentEnd.toString() + "·" + totalScore.toString();
                    ptsTextW = dc.getTextWidthInPixels(ptsStr, fMicro);
                    ptsTagW = ptsTextW + (8.0 * s).toNumber();
                }

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
                    isPadCursorActive ? 0x121106 : 0x050D17,
                    isPadCursorActive ? 0xFFE500 : 0x00A8F3,
                    strokePx
                );
                dc.setColor(isPadCursorActive ? 0xFFE500 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(barStartX + (ptsTagW / 2), barY + (barH / 2), fMicro, ptsStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

                var slotsStartX = barStartX + ptsTagW + barGap;
                for (var si = 0; si < slotCount; si++) {
                    var sx = slotsStartX + si * (slotW + sGap);
                    var hasVal = (si < currentEndArrows.size());
                    var sVal = hasVal ? currentEndArrows[si] : "-";
                    var sBorder = hasVal
                        ? ((sVal.equals("X") || sVal.equals("10") || sVal.equals("9")) ? 0xFFE500 : ((sVal.equals("8") || sVal.equals("7")) ? 0xFF1E1E : ((sVal.equals("6") || sVal.equals("5")) ? 0x00A8F3 : 0x94A3B8)))
                        : 0x334155;
                    var sTxtCol = hasVal ? ((sVal.equals("X") || sVal.equals("10") || sVal.equals("9")) ? 0xFFE500 : Graphics.COLOR_WHITE) : 0x64748B;
                    drawCrispBox(dc, sx, barY, slotW, barH, (3.8 * s).toNumber(), 0x07090E, sBorder, 1);
                    dc.setColor(sTxtCol, Graphics.COLOR_TRANSPARENT);
                    dc.drawText(sx + (slotW / 2), barY + (barH / 2), fMicro, sVal, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                }
                kStartY = barY + barH + (4.2 * s).toNumber();
            }

            var actH = isMono ? (isCompactMono ? 19 : 21) : (26.0 * s).toNumber();
            if (!isMono && actH < (microH + 4)) { actH = microH + 4; }
            var pagerClearance = isMono ? 13 : (33.0 * s).toNumber();
            var actY = h - pagerClearance - actH;

            var padW = isMono ? (w - 12) : (190.0 * s).toNumber();
            var kGap = isMono ? 2 : (4.0 * s).toNumber();
            if (kGap < 2) { kGap = 2; }
            var kEndY = actY - (isMono ? 3 : (4.2 * s).toNumber());
            var gridAvailH = kEndY - kStartY;
            var keyW = (padW - (3 * kGap)) / 4;
            var keyH = (gridAvailH - (2 * kGap)) / 3;
            var minKeyH = isMono ? 17 : (18.0 * s).toNumber();
            if (keyH < minKeyH) {
                keyH = minKeyH;
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
                var isSel = isPadCursorActive && (k == selectedScoreIdx);

                var bgCol = isMono
                    ? (isSel ? 0xFFFFFF : 0x000000)
                    : (isSel ? 0x1E293B : ((k < 3) ? 0x121107 : ((k < 5) ? 0x160708 : ((k < 7) ? 0x061320 : 0x0B0E15))));
                var borderCol = isMono
                    ? 0xFFFFFF
                    : (isSel ? 0xFFFFFF : ((k < 3) ? 0xFFE500 : ((k < 5) ? 0xFF1E1E : ((k < 7) ? 0x00A8F3 : 0x475569))));
                var txtCol = isMono
                    ? (isSel ? 0x000000 : 0xFFFFFF)
                    : (isSel ? 0xFFFFFF : ((k < 3) ? 0xFFE500 : ((k == 11) ? 0xCBD5E1 : Graphics.COLOR_WHITE)));
                var kStroke = (!isMono && isSel) ? (strokePx + 1) : strokePx;

                drawCrispBox(dc, kx, ky, keyW, keyH, isMono ? 3 : (6.5 * s).toNumber(), bgCol, borderCol, kStroke);
                var keyFont = pickFittingFont(dc, scoreLabels[k], keyW - 4, fValue, fLabel, fMicro);
                dc.setColor(txtCol, Graphics.COLOR_TRANSPARENT);
                dc.drawText(kx + (keyW / 2), ky + (keyH / 2), keyFont, scoreLabels[k], Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Bottom Actions: [ 12: BORRAR / DEL ]   [ 13: SIG. TANDA / NEXT END ]
            var actGap = isMono ? 5 : (6.0 * s).toNumber();
            var actWTotal = isMono ? (w - 14) : (158.0 * s).toNumber();
            var actStartX = cx - (actWTotal / 2);
            var actW = (actWTotal - actGap) / 2;
            var actBtnInnerW = actW - 8;

            var selDel = isPadCursorActive && (selectedScoreIdx == 12);
            var delLbl = tr("BORRAR", "DEL");
            drawCrispBox(
                dc,
                actStartX,
                actY,
                actW,
                actH,
                actH / 2,
                isMono ? (selDel ? 0xFFFFFF : 0x000000) : (selDel ? 0x260709 : 0x0B0E15),
                isMono ? 0xFFFFFF : (selDel ? 0xFFFFFF : 0x475569),
                (!isMono && selDel) ? (strokePx + 1) : strokePx
            );
            dc.setColor((isMono && selDel) ? 0x000000 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(actStartX + (actW / 2), actY + (actH / 2), fMicro, delLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var selNext = isPadCursorActive && (selectedScoreIdx == 13);
            var nextFull = tr("SIG. TANDA", "NEXT END");
            var nextShort = tr("SIG.", "NEXT");
            var nextLbl = (dc.getTextWidthInPixels(nextFull, fMicro) <= actBtnInnerW) ? nextFull : nextShort;
            var nextX = actStartX + actW + actGap;
            drawCrispBox(
                dc,
                nextX,
                actY,
                actW,
                actH,
                actH / 2,
                isMono ? (selNext ? 0xFFFFFF : 0x000000) : (selNext ? 0x0B253C : 0x061523),
                isMono ? 0xFFFFFF : (selNext ? 0xFFFFFF : 0x00A8F3),
                (!isMono && selNext) ? (strokePx + 1) : strokePx
            );
            dc.setColor((isMono && selNext) ? 0x000000 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(nextX + (actW / 2), actY + (actH / 2), fMicro, nextLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 2) {
            drawArchery101010Header(dc, w, h, s, tr("BIOMETRÍA", "BIOMETRICS"), false, isMono);

            var cardW = isMono ? (w - 12) : (164.0 * s).toNumber();
            var cardH = isMono ? (isCompactMono ? 34 : 38) : (44.0 * s).toNumber();
            var cardX = cx - (cardW / 2);
            var card1Y = isMono ? 62 : (68.0 * s).toNumber();
            var card2Y = isMono ? (card1Y + cardH + 3) : (119.0 * s).toNumber();
            var innerMaxW = cardW - 10;

            drawCrispBox(dc, cardX, card1Y, cardW, cardH, isMono ? 5 : (9.0 * s).toNumber(), isMono ? 0x000000 : 0x07090E, isMono ? 0xFFFFFF : 0x00A8F3, strokePx);
            var distHdrFull = tr("DISTANCIA · ", "DISTANCE · ") + stepsCount.toString() + tr(" PASOS", " STEPS");
            var distHdrShort = stepsCount.toString() + tr(" PASOS", " STEPS");
            var distHdr = (dc.getTextWidthInPixels(distHdrFull, fMicro) <= innerMaxW) ? distHdrFull : distHdrShort;
            dc.setColor(isMono ? 0xFFFFFF : 0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card1Y + (isMono ? 10 : (13.0 * s).toNumber()), fMicro, distHdr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            var distFont = pickFittingFont(dc, walkedDualStr, innerMaxW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card1Y + (isMono ? (cardH - 11) : (30.0 * s).toNumber()), distFont, walkedDualStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            drawCrispBox(dc, cardX, card2Y, cardW, cardH, isMono ? 5 : (9.0 * s).toNumber(), isMono ? 0x000000 : 0x07090E, isMono ? 0xFFFFFF : 0xFF1E1E, strokePx);
            dc.setColor(isMono ? 0xFFFFFF : 0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card2Y + (isMono ? 10 : (13.0 * s).toNumber()), fMicro, tr("ENERGÍA", "ENERGY"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            var kcalStr = activeKcal.toString() + " kcal";
            var kcalFont = pickFittingFont(dc, kcalStr, innerMaxW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card2Y + (isMono ? (cardH - 11) : (30.0 * s).toNumber()), kcalFont, kcalStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var bioFootFull = (heartRateBpm >= 35)
                ? (heartRateBpm.toString() + " BPM · " + arrowsCount.toString() + tr(" FLECHAS", " ARROWS"))
                : (arrowsCount.toString() + tr(" FLECHAS · ", " ARROWS · ") + bowPoundageLbs.toString() + " LBS");
            var bioFootShort = (heartRateBpm >= 35)
                ? (heartRateBpm.toString() + " BPM · " + arrowsCount.toString() + tr(" FL", " AR"))
                : (arrowsCount.toString() + tr(" FL · ", " AR · ") + bowPoundageLbs.toString() + " LBS");
            var bioFoot = (dc.getTextWidthInPixels(bioFootFull, fMicro) <= innerMaxW) ? bioFootFull : bioFootShort;
            var bioFootY = isMono ? (card2Y + cardH + (isCompactMono ? 8 : 11)) : (177.0 * s).toNumber();
            dc.setColor(isMono ? 0xFFFFFF : 0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, bioFootY, fMicro, bioFoot, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 3) {
            var justSaved = (lastSavedFeedbackMs > 0) && (now < lastSavedFeedbackMs);
            var warnUnlinked = (mFinishWarnUntilMs > 0) && (now < mFinishWarnUntilMs);
            var confirmFinishArmed = (mConfirmFinishUntilMs > 0) && (now < mConfirmFinishUntilMs);
            var confirmResetArmed = (mConfirmResetUntilMs > 0) && (now < mConfirmResetUntilMs);

            var sumStatus = warnUnlinked
                ? (isMono ? tr("VINCULA APP", "LINK APP") : tr("VINCULA ANTES DE BORRAR", "LINK BEFORE SAVING"))
                : (confirmFinishArmed
                    ? (isMono ? tr("CONFIRMAR", "CONFIRM") : tr("CONFIRMAR GUARDAR", "CONFIRM SAVE"))
                    : (confirmResetArmed
                        ? (isMono ? tr("CONFIRMAR", "CONFIRM") : tr("CONFIRMAR NUEVA", "CONFIRM RESET"))
                        : (justSaved
                            ? tr("ENVIADO", "SAVED")
                            : (isConnectedNow ? tr("RESUMEN · SYNC", "SUMMARY · SYNC") : tr("RESUMEN", "SUMMARY")))));
            if (dc.getTextWidthInPixels(sumStatus, fMicro) > maxPillTxtW) {
                sumStatus = warnUnlinked
                    ? tr("VINCULA ANTES", "LINK FIRST")
                    : (confirmFinishArmed ? tr("CONFIRMAR", "CONFIRM") : tr("RESUMEN", "SUMMARY"));
            }
            drawArchery101010Header(dc, w, h, s, sumStatus, false, isMono);

            var sumW = isMono ? (w - 12) : (164.0 * s).toNumber();
            var sumX = cx - (sumW / 2);
            var sumY = isMono ? 62 : (70.0 * s).toNumber();
            var sumH = isMono ? (isCompactMono ? 55 : 62) : (72.0 * s).toNumber();
            var sumInnerW = sumW - 10;
            var halfW = (sumW / 2) - 6;
            var leftColCx = sumX + (sumW / 4);
            var rightColCx = sumX + ((sumW * 3) / 4);

            drawCrispBox(dc, sumX, sumY, sumW, sumH, isMono ? 5 : (10.0 * s).toNumber(), isMono ? 0x000000 : 0x07090E, isMono ? 0xFFFFFF : (isConnectedNow ? 0x00A8F3 : 0xFFE500), strokePx);

            dc.setColor(isMono ? 0xFFFFFF : 0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(leftColCx, sumY + (isMono ? 10 : (12.0 * s).toNumber()), fMicro, tr("FLECHAS", "ARROWS"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.drawText(rightColCx, sumY + (isMono ? 10 : (12.0 * s).toNumber()), fMicro, tr("PUNTAJE", "SCORE"), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var arrValStr = arrowsCount.toString();
            var arrFont = pickFittingFont(dc, arrValStr, halfW, fValue, fLabel, fMicro);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(leftColCx, sumY + (isMono ? 25 : (30.0 * s).toNumber()), arrFont, arrValStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var ptsValStr = totalScore.toString();
            var ptsFont = pickFittingFont(dc, ptsValStr, halfW, fValue, fLabel, fMicro);
            dc.setColor(isMono ? 0xFFFFFF : 0xFFE500, Graphics.COLOR_TRANSPARENT);
            dc.drawText(rightColCx, sumY + (isMono ? 25 : (30.0 * s).toNumber()), ptsFont, ptsValStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var divY = sumY + (isMono ? 37 : (45.0 * s).toNumber());
            dc.setColor(isMono ? 0xFFFFFF : 0x1E293B, Graphics.COLOR_TRANSPARENT);
            dc.drawLine(cx, sumY + 6, cx, divY - 3);
            dc.drawLine(sumX + 8, divY, sumX + sumW - 8, divY);

            var line2 = warnUnlinked
                ? tr("VINCULA ANTES DE BORRAR", "LINK BEFORE SAVING")
                : (walkedPrimaryStr + " · " + activeKcal.toString() + " kcal");
            var line2Font = pickFittingFont(dc, line2, sumInnerW, fMicro, fMicro, fMicro);
            dc.setColor(isMono ? 0xFFFFFF : (warnUnlinked ? 0xFF1E1E : Graphics.COLOR_WHITE), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, sumY + (isMono ? (sumH - 9) : (58.0 * s).toNumber()), line2Font, line2, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var ctaTotalW = isMono ? (w - 14) : (158.0 * s).toNumber();
            var ctaGap = isMono ? 5 : (6.0 * s).toNumber();
            var ctaBtnW = (ctaTotalW - ctaGap) / 2;
            var ctaH = isMono ? (isCompactMono ? 20 : 23) : (26.0 * s).toNumber();
            var ctaStartX = cx - (ctaTotalW / 2);
            var ctaY = isMono ? (sumY + sumH + 4) : (152.0 * s).toNumber();
            lastCtaY = ctaY;
            lastCtaH = ctaH;

            var rstLbl = confirmResetArmed ? tr("CONFIRMAR", "CONFIRM") : tr("NUEVA", "RESET");
            drawCrispBox(
                dc,
                ctaStartX,
                ctaY,
                ctaBtnW,
                ctaH,
                ctaH / 2,
                isMono ? (confirmResetArmed ? 0xFFFFFF : 0x000000) : (confirmResetArmed ? 0x260709 : 0x0B0E15),
                isMono ? 0xFFFFFF : (confirmResetArmed ? 0xFF1E1E : 0x475569),
                strokePx
            );
            dc.setColor((isMono && confirmResetArmed) ? 0x000000 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(ctaStartX + (ctaBtnW / 2), ctaY + (ctaH / 2), fMicro, rstLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var saveBtnX = ctaStartX + ctaBtnW + ctaGap;
            var saveFullLbl = confirmFinishArmed ? tr("CONFIRMAR GUARDAR", "CONFIRM SAVE") : (justSaved ? tr("ENVIADO", "SAVED") : tr("GUARDAR", "SAVE"));
            if (dc.getTextWidthInPixels(saveFullLbl, fMicro) > (ctaBtnW - 6)) {
                saveFullLbl = confirmFinishArmed ? tr("CONFIRMAR", "CONFIRM") : (justSaved ? tr("ENVIADO", "SAVED") : tr("GUARDAR", "SAVE"));
            }
            var saveInv = isMono && (confirmFinishArmed || justSaved);
            drawCrispBox(
                dc,
                saveBtnX,
                ctaY,
                ctaBtnW,
                ctaH,
                ctaH / 2,
                isMono ? (saveInv ? 0xFFFFFF : 0x000000) : (confirmFinishArmed ? 0x151105 : 0x061523),
                isMono ? 0xFFFFFF : ((confirmFinishArmed || justSaved) ? 0xFFE500 : 0x00A8F3),
                strokePx
            );
            dc.setColor(saveInv ? 0x000000 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(saveBtnX + (ctaBtnW / 2), ctaY + (ctaH / 2), fMicro, saveFullLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else {
            // SCREEN 4: 6-DIGIT CLOUD PAIRING -> 256-BIT SESSION TOKEN
            var pairHeader = isEditingCode
                ? (tr("EDITAR ", "EDIT ") + (editDigitPos + 1).toString() + "/6")
                : (isCloudSynced
                    ? tr("VINCULADO", "SYNCED")
                    : (mCloudErrorState.equals("EXPIRED")
                        ? tr("CÓDIGO EXPIRADO", "CODE EXPIRED")
                        : (mCloudErrorState.equals("INVALID")
                            ? tr("CÓDIGO INVÁLIDO", "INVALID CODE")
                            : (mCloudErrorState.equals("NO_BLE")
                                ? tr("SIN TELÉFONO BLE", "NO PHONE BLE")
                                : (mHandshakeInFlight
                                    ? tr("VINCULANDO", "LINKING")
                                    : (hasPairingCode
                                        ? tr("CÓDIGO NUBE", "CLOUD CODE")
                                        : (isTouchScreen ? tr("TOCA PARA VINCULAR", "TAP TO LINK") : tr("PULSA VINCULAR", "PRESS TO LINK"))))))));

            if (dc.getTextWidthInPixels(pairHeader, fMicro) > maxPillTxtW) {
                pairHeader = isEditingCode
                    ? ("EDIT " + (editDigitPos + 1).toString() + "/6")
                    : (isCloudSynced
                        ? tr("VINCULADO", "SYNCED")
                        : (mCloudErrorState.equals("EXPIRED")
                            ? tr("EXPIRADO", "EXPIRED")
                            : (mCloudErrorState.equals("INVALID")
                                ? tr("INVÁLIDO", "INVALID")
                                : (mCloudErrorState.equals("NO_BLE")
                                    ? tr("SIN BLE", "NO BLE")
                                    : tr("VINCULAR", "LINK")))));
            }
            drawArchery101010Header(dc, w, h, s, pairHeader, false, isMono);

            var dBoxW = isMono ? (isCompactMono ? 22 : 24) : (23.0 * s).toNumber();
            var dBoxH = isMono ? (isCompactMono ? 27 : 31) : (38.0 * s).toNumber();
            var dGap = isMono ? 3 : (4.0 * s).toNumber();
            var dTotalW = (dBoxW * 6) + (dGap * 5);
            var dStartX = cx - (dTotalW / 2);
            var dStartY = isMono ? 62 : (69.0 * s).toNumber();

            lastDigitStartX = dStartX;
            lastDigitStartY = dStartY;
            lastDigitW = dBoxW;
            lastDigitH = dBoxH;
            lastDigitGap = dGap;

            for (var di = 0; di < 6; di++) {
                var dx = dStartX + di * (dBoxW + dGap);
                var isCurDigit = isEditingCode && (di == editDigitPos);
                var dFill = isMono
                    ? (isCurDigit ? 0xFFFFFF : 0x000000)
                    : (isCurDigit ? 0x081523 : 0x0B0E15);
                var dBorder = isMono
                    ? 0xFFFFFF
                    : (isCurDigit ? 0x00A8F3 : (hasPairingCode ? 0xFFE500 : 0x475569));
                var dTxtCol = isMono
                    ? (isCurDigit ? 0x000000 : 0xFFFFFF)
                    : (isCurDigit ? Graphics.COLOR_WHITE : (hasPairingCode ? 0xFFE500 : 0x94A3B8));
                drawCrispBox(dc, dx, dStartY, dBoxW, dBoxH, isMono ? 3 : (5.0 * s).toNumber(), dFill, dBorder, strokePx);
                dc.setColor(dTxtCol, Graphics.COLOR_TRANSPARENT);
                dc.drawText(dx + (dBoxW / 2), dStartY + (dBoxH / 2), fValue, pairingDigits[di].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Touch & Button Row: [-] | [EDITAR > / EDIT >] | [+]
            var ctrlY = isMono ? (dStartY + dBoxH + 4) : (116.0 * s).toNumber();
            var ctrlH = isMono ? (isCompactMono ? 20 : 22) : (25.0 * s).toNumber();
            var ctrlW = isMono ? (w - 14) : (156.0 * s).toNumber();
            var cStartX = cx - (ctrlW / 2);
            var smallW = isMono ? 30 : (36.0 * s).toNumber();
            var btnGap = isMono ? 4 : (6.0 * s).toNumber();
            var midW = ctrlW - (2 * smallW) - (2 * btnGap);
            lastPairCtrlY = ctrlY;
            lastPairCtrlH = ctrlH;

            drawCrispBox(dc, cStartX, ctrlY, smallW, ctrlH, ctrlH / 2, isMono ? 0x000000 : 0x180709, isMono ? 0xFFFFFF : 0xFF1E1E, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cStartX + (smallW / 2), ctrlY + (ctrlH / 2), fLabel, "-", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var midX = cStartX + smallW + btnGap;
            var midLbl = isEditingCode ? tr("SIG >", "NEXT >") : tr("EDITAR", "EDIT");
            if (dc.getTextWidthInPixels(midLbl, fMicro) > (midW - 6)) {
                midLbl = "EDIT";
            }
            drawCrispBox(dc, midX, ctrlY, midW, ctrlH, ctrlH / 2, isMono ? 0x000000 : 0x0B0E15, isMono ? 0xFFFFFF : 0x475569, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(midX + (midW / 2), ctrlY + (ctrlH / 2), fMicro, midLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var plusBtnX = midX + midW + btnGap;
            drawCrispBox(dc, plusBtnX, ctrlY, smallW, ctrlH, ctrlH / 2, isMono ? 0x000000 : 0x061523, isMono ? 0xFFFFFF : 0x00A8F3, strokePx);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(plusBtnX + (smallW / 2), ctrlY + (ctrlH / 2), fLabel, "+", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            // Full-width bottom CTA / Status Pill (shows complete status even on Instinct 2 subscreen displays)
            var saveW = isMono ? (w - 14) : (156.0 * s).toNumber();
            var saveH = isMono ? (isCompactMono ? 20 : 23) : (25.0 * s).toNumber();
            var saveX = cx - (saveW / 2);
            var saveY = isMono ? (ctrlY + ctrlH + 4) : (149.0 * s).toNumber();
            lastPairSaveY = saveY;
            lastPairSaveH = saveH;

            var saveLbl = isEditingCode
                ? tr("LISTO · VINCULAR", "DONE · LINK")
                : (isCloudSynced
                    ? tr("VINCULADO · LIVE", "SYNCED · LIVE")
                    : (mCloudErrorState.equals("EXPIRED")
                        ? tr("CÓDIGO EXPIRADO", "CODE EXPIRED")
                        : (mCloudErrorState.equals("INVALID")
                            ? tr("CÓDIGO INVÁLIDO", "INVALID CODE")
                            : (mCloudErrorState.equals("NO_BLE")
                                ? tr("SIN TELÉFONO BLE", "NO PHONE BLE")
                                : (isTouchScreen ? tr("TOCA PARA VINCULAR", "TAP TO LINK") : tr("PULSA VINCULAR", "PRESS TO LINK"))))));
            if (dc.getTextWidthInPixels(saveLbl, fMicro) > (saveW - 8)) {
                saveLbl = isEditingCode
                    ? tr("LISTO", "DONE")
                    : (isCloudSynced
                        ? tr("VINCULADO", "SYNCED")
                        : (mCloudErrorState.equals("EXPIRED")
                            ? tr("CÓDIGO EXPIRADO", "CODE EXPIRED")
                            : (mCloudErrorState.equals("INVALID")
                                ? tr("CÓDIGO INVÁLIDO", "INVALID CODE")
                                : (mCloudErrorState.equals("NO_BLE")
                                    ? tr("SIN TELÉFONO BLE", "NO PHONE BLE")
                                    : tr("VINCULAR", "LINK")))));
            }
            var isErrCta = !isEditingCode && (mCloudErrorState.equals("EXPIRED") || mCloudErrorState.equals("INVALID"));
            var saveInv4 = isMono && (isEditingCode || isCloudSynced);
            drawCrispBox(
                dc,
                saveX,
                saveY,
                saveW,
                saveH,
                saveH / 2,
                isMono ? (saveInv4 ? 0xFFFFFF : 0x000000) : (isErrCta ? 0x220709 : 0x061523),
                isMono ? 0xFFFFFF : (isErrCta ? 0xFF1E1E : (isCloudSynced ? 0xFFE500 : 0x00A8F3)),
                strokePx
            );
            dc.setColor(saveInv4 ? 0x000000 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, saveY + (saveH / 2), fMicro, saveLbl, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        drawPagerDots(dc, w, h, s, isMono);
    }
}

class Archery101010WatchDelegate extends WatchUi.BehaviorDelegate {
    private var mView as Archery101010WatchView;

    function initialize(view as Archery101010WatchView) {
        BehaviorDelegate.initialize();
        mView = view;
    }

    function onSelect() {
        mView.mConfirmExitUntilMs = 0;
        if (mView.screenIdx == 0 && mView.analysisMode) {
            mView.toggleManualAnalysisFromHardware();
        } else if (mView.screenIdx == 0) {
            mView.incrementArrow(1, false);
        } else if (mView.screenIdx == 1) {
            // AUD-GAR-04: First Select enters cursor mode on Screen 1; subsequent Selects execute X..M, BORRAR (12), or SIG. TANDA (13)
            if (!mView.isPadCursorActive) {
                mView.isPadCursorActive = true;
                mView.markUserActivity(true);
                if (Attention has :vibrate) {
                    Attention.vibrate([new Attention.VibeProfile(45, 30)]);
                }
                WatchUi.requestUpdate();
            } else if (mView.selectedScoreIdx >= 0 && mView.selectedScoreIdx < 12) {
                var val = mView.scoreLabels[mView.selectedScoreIdx];
                mView.recordScoreInput(val);
            } else if (mView.selectedScoreIdx == 12) {
                mView.undoLastScore();
            } else if (mView.selectedScoreIdx == 13) {
                mView.advanceNextEnd();
            }
        } else if (mView.screenIdx == 2) {
            mView.markUserActivity(true);
            mView.sendTelemetryPing();
        } else if (mView.screenIdx == 3) {
            mView.requestSafeFinishSession();
        } else if (mView.screenIdx == 4) {
            if (!mView.isEditingCode) {
                mView.isEditingCode = true;
                mView.editDigitPos = 0;
                mView.markUserActivity(true);
                WatchUi.requestUpdate();
            } else if (mView.editDigitPos < 5) {
                mView.mCodeEditedByUser = true;
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
        mView.mConfirmExitUntilMs = 0;
        if (mView.screenIdx == 1 && mView.isPadCursorActive) {
            mView.selectedScoreIdx = (mView.selectedScoreIdx + 1) % 14;
            mView.markUserActivity(true);
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(30, 20)]);
            }
            WatchUi.requestUpdate();
            return true;
        }
        if (mView.screenIdx == 4 && mView.isEditingCode) {
            mView.adjustSelectedCodeDigit(-1);
            return true;
        }
        mView.isPadCursorActive = false;
        mView.mConfirmFinishUntilMs = 0;
        mView.mConfirmResetUntilMs = 0;
        mView.screenIdx = (mView.screenIdx + 1) % 5;
        mView.markUserActivity(false);
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() {
        mView.mConfirmExitUntilMs = 0;
        if (mView.screenIdx == 1 && mView.isPadCursorActive) {
            mView.selectedScoreIdx = (mView.selectedScoreIdx + 13) % 14;
            mView.markUserActivity(true);
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(30, 20)]);
            }
            WatchUi.requestUpdate();
            return true;
        }
        if (mView.screenIdx == 4 && mView.isEditingCode) {
            mView.adjustSelectedCodeDigit(1);
            return true;
        }
        mView.isPadCursorActive = false;
        mView.mConfirmFinishUntilMs = 0;
        mView.mConfirmResetUntilMs = 0;
        mView.screenIdx = (mView.screenIdx + 4) % 5;
        mView.markUserActivity(false);
        WatchUi.requestUpdate();
        return true;
    }

    function onSwipe(swipeEvent as WatchUi.SwipeEvent) {
        mView.mConfirmExitUntilMs = 0;
        var dir = swipeEvent.getDirection();
        if (dir == WatchUi.SWIPE_LEFT) {
            mView.isEditingCode = false;
            mView.isPadCursorActive = false;
            mView.mConfirmFinishUntilMs = 0;
            mView.mConfirmResetUntilMs = 0;
            mView.screenIdx = (mView.screenIdx + 1) % 5;
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        } else if (dir == WatchUi.SWIPE_RIGHT) {
            if (mView.screenIdx == 4 && mView.isEditingCode) {
                mView.isEditingCode = false;
            } else if (mView.screenIdx == 1 && mView.isPadCursorActive) {
                mView.isPadCursorActive = false;
            } else {
                mView.mConfirmFinishUntilMs = 0;
                mView.mConfirmResetUntilMs = 0;
                mView.screenIdx = (mView.screenIdx + 4) % 5;
            }
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        }
        return false;
    }

    function onBack() {
        var now = System.getTimer();
        if (mView.screenIdx == 4 && mView.isEditingCode) {
            if (mView.editDigitPos > 0) {
                mView.editDigitPos = mView.editDigitPos - 1;
            } else {
                mView.isEditingCode = false;
            }
            mView.markUserActivity(true);
            WatchUi.requestUpdate();
            return true;
        }
        if (mView.screenIdx == 1 && mView.isPadCursorActive) {
            mView.isPadCursorActive = false;
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        }
        if (mView.screenIdx == 3 && ((mView.mConfirmFinishUntilMs > 0 && now < mView.mConfirmFinishUntilMs) || (mView.mConfirmResetUntilMs > 0 && now < mView.mConfirmResetUntilMs))) {
            mView.mConfirmFinishUntilMs = 0;
            mView.mConfirmResetUntilMs = 0;
            WatchUi.requestUpdate();
            return true;
        }
        if (mView.screenIdx > 0) {
            mView.isPadCursorActive = false;
            mView.screenIdx = mView.screenIdx - 1;
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        }

        // AUD-GAR-08: Require double-Back confirmation on Screen 0 when arrowsCount > 0 (or queued items pending) before closing app
        if (mView.arrowsCount > 0 || mView.mPendingCmdQueue.size() > 0 || mView.manualAnalysisRecording) {
            if (now >= mView.mConfirmExitUntilMs) {
                mView.mConfirmExitUntilMs = now + 3500;
                if (Attention has :vibrate) {
                    Attention.vibrate([new Attention.VibeProfile(55, 50)]);
                }
                WatchUi.requestUpdate();
                return true;
            }
            mView.saveStateToStorage();
        }
        return false;
    }

    function onMenu() {
        mView.mConfirmExitUntilMs = 0;
        if (mView.screenIdx == 0 && !mView.analysisMode) {
            if (mView.arrowsCount > 0) {
                mView.incrementArrow(-1, false);
            }
            return true;
        }
        if (mView.screenIdx == 1) {
            if (!mView.isPadCursorActive) {
                mView.isPadCursorActive = true;
                mView.selectedScoreIdx = 12; // Jump directly to BORRAR / SIG. TANDA actions
            } else if (mView.selectedScoreIdx == 12) {
                mView.selectedScoreIdx = 13;
            } else {
                mView.selectedScoreIdx = 12;
            }
            mView.markUserActivity(true);
            WatchUi.requestUpdate();
            return true;
        }
        if (mView.screenIdx == 3) {
            mView.requestSafeResetSession();
            return true;
        }
        mView.markUserActivity(false);
        return true;
    }

    function onTap(clickEvent as WatchUi.ClickEvent) {
        mView.mConfirmExitUntilMs = 0;
        var coords = clickEvent.getCoordinates();
        if (coords.size() < 2) {
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
            mView.isPadCursorActive = false;
            mView.mConfirmFinishUntilMs = 0;
            mView.mConfirmResetUntilMs = 0;
            mView.screenIdx = (mView.screenIdx + 1) % 5;
            mView.markUserActivity(false);
            WatchUi.requestUpdate();
            return true;
        }

        if (mView.screenIdx == 0 && mView.analysisMode) {
            if (ty >= (114.0 * s) && ty <= (162.0 * s)) {
                if (tx < (cx - (2.5 * s))) {
                    mView.startManualAnalysis(true);
                    return true;
                } else if (tx > (cx + (2.5 * s))) {
                    mView.stopManualAnalysis(true);
                    return true;
                }
            }
        } else if (mView.screenIdx == 0) {
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

            var actTop = mView.lastActY - 3;
            var actBot = mView.lastActY + mView.lastActH + 4;
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
            mView.sendTelemetryPing();
            return true;
        } else if (mView.screenIdx == 3) {
            if (ty >= (mView.lastCtaY - 4) && ty <= (mView.lastCtaY + mView.lastCtaH + 6)) {
                if (tx < cx) {
                    mView.requestSafeResetSession();
                } else {
                    mView.requestSafeFinishSession();
                }
                return true;
            }
        } else if (mView.screenIdx == 4) {
            var dBoxW = mView.lastDigitW;
            var dBoxH = mView.lastDigitH;
            var dGap = mView.lastDigitGap;
            var dStartX = mView.lastDigitStartX;
            var dStartY = mView.lastDigitStartY;

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

            if (ty >= (mView.lastPairCtrlY - 3) && ty <= (mView.lastPairCtrlY + mView.lastPairCtrlH + 3)) {
                mView.isEditingCode = true;
                if (tx < (cx - (34.0 * s))) {
                    mView.adjustSelectedCodeDigit(-1);
                } else if (tx > (cx + (34.0 * s))) {
                    mView.adjustSelectedCodeDigit(1);
                } else {
                    mView.mCodeEditedByUser = true;
                    mView.editDigitPos = (mView.editDigitPos + 1) % 6;
                    mView.markUserActivity(true);
                    WatchUi.requestUpdate();
                }
                return true;
            }

            // AUD-GAR-05: Never auto-submit placeholder "101010" before user edits; enter digit-edit mode first!
            if (ty >= (mView.lastPairSaveY - 3) && ty <= (mView.lastPairSaveY + mView.lastPairSaveH + 6)) {
                if (mView.isEditingCode) {
                    mView.commitPairingDigits();
                } else if (!mView.hasPairingCode && !mView.mCodeEditedByUser) {
                    mView.isEditingCode = true;
                    mView.editDigitPos = 0;
                    mView.markUserActivity(true);
                    WatchUi.requestUpdate();
                } else if (mView.mCloudErrorState.equals("EXPIRED") || mView.mCloudErrorState.equals("INVALID")) {
                    mView.isEditingCode = true;
                    mView.editDigitPos = 0;
                    mView.markUserActivity(true);
                    WatchUi.requestUpdate();
                } else {
                    mView.mHandshakeBlockedCode = "";
                    mView.markUserActivity(true);
                    mView.pollFirestoreCloud();
                    WatchUi.requestUpdate();
                }
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
        var pv = mParentView;
        if (pv != null && !pv.isBleConnected) {
            pv.isBleConnected = true;
            WatchUi.requestUpdate();
        }
    }

    function onError() {
        var pv = mParentView;
        if (pv != null && pv.isBleConnected) {
            pv.isBleConnected = false;
            WatchUi.requestUpdate();
        }
    }
}
