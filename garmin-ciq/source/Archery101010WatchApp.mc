using Toybox.Application;
using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Sensor;
using Toybox.Position;
using Toybox.Attention;
using Toybox.Communications;
using Toybox.Math;
using Toybox.System;
using Toybox.Lang;

/**
 * ARCHERY 101010 — Garmin Connect IQ Watch App (WHOOP / Apple / Nike Matte OLED Edition)
 * 4 Screens synchronized with the ARCHERY 101010 Phone App:
 *  - Screen 0: Contador 4 Dígitos (0 0 0 0) + Auto-Tiro + Mts & Kcal
 *  - Screen 1: Puntuación de Tanda (X, 10, 9, 8, 7, M) + Slots de Tanda
 *  - Screen 2: Métricas Biométricas (Distancia en mts · ft + Gasto Energético en kcal)
 *  - Screen 3: Resumen de Sesión + Envío a Coach
 */
class Archery101010WatchApp extends Application.AppBase {
    hidden var mView;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        if (Communications has :registerForPhoneAppMessages) {
            Communications.registerForPhoneAppMessages(method(:onPhoneMessage));
        }
    }

    function onStop(state) {
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
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
        mView = new Archery101010WatchView();
        var delegate = new Archery101010WatchDelegate(mView);
        return [ mView, delegate ];
    }
}

class Archery101010WatchView extends WatchUi.View {
    public var screenIdx = 0; // 0: Counter, 1: Score Pad, 2: Biometrics (mts/ft + kcal), 3: Summary & Coach Sync
    public var arrowsCount = 0;
    public var totalScore = 0;
    public var currentEnd = 1;
    public var endsCount = 12;
    public var arrowsPerEnd = 6;
    public var distanceM = 18;
    public var bowPoundageLbs = 38;
    public var gpsDistanceM = 0.0;
    public var distanceWalkedM = 0;
    public var activeKcal = 0;
    public var autoDetectEnabled = true;
    public var sensitivityLevel = 1; // 0: BAJA, 1: MEDIA, 2: ALTA
    public var selectedScoreIdx = 0; // 0:X, 1:10, 2:9, 3:8, 4:7, 5:M
    public var scoreLabels = ["X", "10", "9", "8", "7", "M"];
    public var currentEndArrows = [];

    private var mLastLat = null;
    private var mLastLon = null;
    private var mLastShotMs = 0;
    private var mLastStepMs = 0;
    private var mPrevStepMs = 0;
    private var mBaselineSteps = null;
    private var mLastObservedSteps = null;
    private var mWalkingLockUntilMs = 0;
    private var mSmoothedMagMg = 1000.0;
    private var mPreShotRingMg = [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0];
    private var mPreShotRingIdx = 0;
    private var mPreShotRingCount = 0;

    function initialize() {
        View.initialize();
        if (Toybox has :ActivityMonitor) {
            var monInfo = Toybox.ActivityMonitor.getInfo();
            if (monInfo != null && monInfo has :steps && monInfo.steps != null) {
                mBaselineSteps = monInfo.steps;
                mLastObservedSteps = monInfo.steps;
            }
        }
        var timer = new Toybox.Timer.Timer();
        timer.start(method(:onSensorTick), 60, true);
    }

    function isPreShotAnchorSteady(maxQuietAvgMg as Lang.Float) as Lang.Boolean {
        if (mPreShotRingCount < 6) {
            return true;
        }
        var checkCount = 7;
        var sum = 0.0;
        var oldestIdx = (mPreShotRingIdx - mPreShotRingCount + 10) % 10;
        for (var i = 0; i < checkCount; i++) {
            var idx = (oldestIdx + i) % 10;
            sum = sum + mPreShotRingMg[idx];
        }
        return (sum / checkCount) <= maxQuietAvgMg;
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
        syncWithPhoneApp("TOGGLE_AUTO_DETECT", null);
        WatchUi.requestUpdate();
    }

    function onSensorTick() as Void {
        if (!autoDetectEnabled) {
            return;
        }
        var now = System.getTimer();
        if (Toybox has :ActivityMonitor) {
            var monInfo = Toybox.ActivityMonitor.getInfo();
            if (monInfo != null && monInfo has :steps && monInfo.steps != null) {
                if (mLastObservedSteps != null && monInfo.steps > mLastObservedSteps) {
                    mLastObservedSteps = monInfo.steps;
                    mLastStepMs = now;
                    mWalkingLockUntilMs = now + 3800;
                    WatchUi.requestUpdate();
                }
            }
        }
        var info = Sensor.getInfo();
        if (info has :accel && info.accel != null) {
            var ax = info.accel[0];
            var ay = info.accel[1];
            var az = info.accel[2];
            var magMg = Math.sqrt(ax * ax + ay * ay + az * az);
            var dynamicMg = magMg - mSmoothedMagMg;
            mSmoothedMagMg = (0.94 * mSmoothedMagMg) + (0.06 * magMg);
            var deltaMg = (magMg - 1000.0).abs();

            var thresholdMg = (sensitivityLevel == 0) ? 2450.0 : ((sensitivityLevel == 2) ? 1850.0 : 2150.0);
            var quietLimitMg = (sensitivityLevel == 0) ? 210.0 : ((sensitivityLevel == 2) ? 330.0 : 265.0);
            var cooldownMs = (sensitivityLevel == 0) ? 3800 : ((sensitivityLevel == 2) ? 2600 : 3200);

            var isWalkingBlocked = (now < mWalkingLockUntilMs) || ((now - mLastStepMs) < 2200);

            if (!isWalkingBlocked
                && deltaMg >= thresholdMg
                && (now - mLastShotMs) > cooldownMs
                && isPreShotAnchorSteady(quietLimitMg)) {
                mLastShotMs = now;
                mPreShotRingCount = 0;
                incrementArrow(1, true);
            } else if (dynamicMg >= 135.0 && dynamicMg <= 1150.0 && (now - mLastStepMs) > 380 && (now - mLastShotMs) > 1400) {
                mPrevStepMs = mLastStepMs;
                mLastStepMs = now;
                if ((now - mPrevStepMs) <= 4200) {
                    mWalkingLockUntilMs = now + 3800;
                } else if ((now + 2200) > mWalkingLockUntilMs) {
                    mWalkingLockUntilMs = now + 2200;
                }
                WatchUi.requestUpdate();
            }

            var cappedMg = (deltaMg > 1200.0) ? 1200.0 : deltaMg;
            mPreShotRingMg[mPreShotRingIdx] = cappedMg;
            mPreShotRingIdx = (mPreShotRingIdx + 1) % 10;
            if (mPreShotRingCount < 10) {
                mPreShotRingCount = mPreShotRingCount + 1;
            }
        }
    }

    function handleIncomingPhoneData(data) as Void {
        if (data instanceof Lang.Dictionary) {
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
            WatchUi.requestUpdate();
        }
    }

    function updateGpsPosition(info as Position.Info) as Void {
        if (info != null && info has :elapsedDistance && info.elapsedDistance != null && info.elapsedDistance > gpsDistanceM) {
            gpsDistanceM = info.elapsedDistance.toFloat();
            recalculateMetrics();
            WatchUi.requestUpdate();
        }
        if (info.accuracy != null && info.accuracy >= Position.QUALITY_POOR && info.position != null) {
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
                if (stepM >= 1.5 && stepM <= 50.0) {
                    gpsDistanceM += stepM;
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

    function incrementArrow(delta as Lang.Number, isAuto as Lang.Boolean) as Void {
        arrowsCount = arrowsCount + delta;
        if (arrowsCount < 0) { arrowsCount = 0; }
        if (Attention has :vibrate) {
            var vibe = [new Attention.VibeProfile(isAuto ? 85 : 55, isAuto ? 110 : 50)];
            Attention.vibrate(vibe);
        }
        recalculateMetrics();
        syncWithPhoneApp(delta >= 0 ? "INCREMENT_ARROW" : "DECREMENT_ARROW", null);
        WatchUi.requestUpdate();
    }

    function recordScoreInput(val as Lang.String) as Void {
        var pts = (val.equals("X") || val.equals("10")) ? 10 : val.equals("M") ? 0 : val.toNumber();
        if (currentEndArrows.size() >= arrowsPerEnd) {
            currentEndArrows = [];
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
        syncWithPhoneApp("SCORE_INPUT", val);
        WatchUi.requestUpdate();
    }

    function undoLastScore() as Void {
        if (currentEndArrows.size() <= 0) {
            return;
        }
        var lastIdx = currentEndArrows.size() - 1;
        var removed = currentEndArrows[lastIdx];
        currentEndArrows = currentEndArrows.slice(0, lastIdx);
        var pts = (removed.equals("X") || removed.equals("10")) ? 10 : removed.equals("M") ? 0 : removed.toNumber();
        totalScore = (totalScore >= pts) ? (totalScore - pts) : 0;
        if (arrowsCount > 0) {
            arrowsCount = arrowsCount - 1;
        }
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(50, 40)]);
        }
        recalculateMetrics();
        syncWithPhoneApp("UNDO_ARROW", null);
        WatchUi.requestUpdate();
    }

    function advanceNextEnd() as Void {
        if (currentEndArrows.size() <= 0) {
            return;
        }
        currentEndArrows = [];
        if (currentEnd < endsCount) {
            currentEnd = currentEnd + 1;
        }
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(70, 60)]);
        }
        syncWithPhoneApp("NEXT_END", null);
        WatchUi.requestUpdate();
    }

    function recalculateMetrics() as Void {
        var distM = gpsDistanceM;
        if (Toybox has :ActivityMonitor) {
            var monInfo = Toybox.ActivityMonitor.getInfo();
            if (monInfo != null && monInfo has :steps && monInfo.steps != null && mBaselineSteps != null) {
                var stepDelta = monInfo.steps - mBaselineSteps;
                if (stepDelta > 0) {
                    var stepMeters = stepDelta * 0.76;
                    if (stepMeters > distM) {
                        distM = stepMeters;
                    }
                }
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

    function syncWithPhoneApp(eventType as Lang.String, scoreVal) as Void {
        var payload = {
            "type" => eventType,
            "arrowsCount" => arrowsCount,
            "totalScore" => totalScore,
            "distanceWalkedM" => distanceWalkedM,
            "activeKcal" => activeKcal,
            "autoDetectEnabled" => autoDetectEnabled,
            "sensitivityLevel" => sensitivityLevel
        };
        if (scoreVal != null) {
            payload["value"] = scoreVal;
        }
        Communications.transmit(payload, null, new CommListener());
    }

    function drawArchery101010Header(dc as Graphics.Dc, w as Lang.Number, s as Lang.Float, statusLabel as Lang.String) as Void {
        var cx = w / 2;
        var topY = (24.0 * s).toNumber();
        var pillY = (44.0 * s).toNumber();

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx - (26.0 * s).toNumber(), topY, Graphics.FONT_XTINY, "ARCHERY", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + (17.0 * s).toNumber(), topY, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(0xFF1E1E, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + (32.0 * s).toNumber(), topY, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(0xFFE500, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + (47.0 * s).toNumber(), topY, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var isYellow = (statusLabel.find("CAMINANDO") != null) || (statusLabel.find("GPS") != null);
        var pillW = (132.0 * s).toNumber();
        var pillH = (18.0 * s).toNumber();
        var pillX = cx - (pillW / 2);

        dc.setColor(isYellow ? 0x101006 : 0x040B12, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(pillX, pillY, pillW, pillH, pillH / 2);
        dc.setColor(isYellow ? 0xFFE500 : 0x00A8F3, Graphics.COLOR_TRANSPARENT);
        dc.drawRoundedRectangle(pillX, pillY, pillW, pillH, pillH / 2);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, pillY + (pillH / 2), Graphics.FONT_XTINY, statusLabel, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function drawPagerDots(dc as Graphics.Dc, w as Lang.Number, h as Lang.Number, s as Lang.Float) as Void {
        var cx = w / 2;
        var dotY = h - (15.0 * s).toNumber();
        var activeW = (12.0 * s).toNumber();
        var inactiveW = (4.0 * s).toNumber();
        var dotH = (4.0 * s).toNumber();
        var gap = (5.0 * s).toNumber();
        var totalW = activeW + (3 * inactiveW) + (3 * gap);
        var curX = cx - (totalW / 2);

        for (var i = 0; i < 4; i++) {
            var itemW = (i == screenIdx) ? activeW : inactiveW;
            dc.setColor((i == screenIdx) ? 0x00A8F3 : 0x334155, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(curX, dotY - (dotH / 2), itemW, dotH, dotH / 2);
            curX = curX + itemW + gap;
        }
    }

    public var lastScreenWidth = 240;
    public var lastScreenHeight = 240;

    function onUpdate(dc as Graphics.Dc) as Void {
        recalculateMetrics();
        var w = dc.getWidth();
        var h = dc.getHeight();
        lastScreenWidth = w;
        lastScreenHeight = h;
        var minDim = (w < h) ? w : h;
        var s = minDim / 240.0;
        var cx = w / 2;
        var cy = h / 2;

        // Matte OLED Black Background
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var mts = distanceWalkedM;
        var ft = (distanceWalkedM * 3.28084).toNumber();
        var mtsFtStr = mts.toString() + " mts · " + ft.toString() + " ft";

        if (screenIdx == 0) {
            var sensTxt = (sensitivityLevel == 0) ? "BAJA" : ((sensitivityLevel == 2) ? "ALTA" : "MEDIA");
            var pillTxt = !autoDetectEnabled
                ? "MODO MANUAL"
                : ((System.getTimer() < mWalkingLockUntilMs) ? "PAUSA · CAMINANDO" : ("AUTO · " + sensTxt + " · LIVE"));
            drawArchery101010Header(dc, w, s, pillTxt);

            var d3 = (arrowsCount / 1000) % 10;
            var d2 = (arrowsCount / 100) % 10;
            var d1 = (arrowsCount / 10) % 10;
            var d0 = arrowsCount % 10;
            var digits = [d3, d2, d1, d0];

            var boxW = (36.0 * s).toNumber();
            var boxH = (52.0 * s).toNumber();
            var gap = (5.0 * s).toNumber();
            var totalW = (boxW * 4) + (gap * 3);
            var startX = cx - (totalW / 2);
            var startY = (82.0 * s).toNumber();

            for (var i = 0; i < 4; i++) {
                var rx = startX + i * (boxW + gap);
                dc.setColor(i == 3 ? 0x101008 : 0x0B0E15, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(rx, startY, boxW, boxH, (7.0 * s).toNumber());
                dc.setColor(i == 3 ? 0xFFE500 : 0x2A2F3A, Graphics.COLOR_TRANSPARENT);
                dc.drawRoundedRectangle(rx, startY, boxW, boxH, (7.0 * s).toNumber());

                dc.setColor(i == 3 ? 0xFFE500 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(rx + (boxW / 2), startY + (boxH / 2), Graphics.FONT_NUMBER_MEDIUM, digits[i].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Bottom row: [-1] | mts & kcal | [+1]
            var rowY = (154.0 * s).toNumber();
            var btnW = (32.0 * s).toNumber();
            var btnH = (24.0 * s).toNumber();
            var rowW = (164.0 * s).toNumber();

            // -1 Button
            var minusX = cx - (rowW / 2);
            dc.setColor(0x180709, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(minusX, rowY, btnW, btnH, btnH / 2);
            dc.setColor(0xFF1E1E, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(minusX, rowY, btnW, btnH, btnH / 2);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(minusX + (btnW / 2), rowY + (btnH / 2), Graphics.FONT_XTINY, "-1", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            // +1 Button
            var plusX = cx + (rowW / 2) - btnW;
            dc.setColor(0x061523, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(plusX, rowY, btnW, btnH, btnH / 2);
            dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(plusX, rowY, btnW, btnH, btnH / 2);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(plusX + (btnW / 2), rowY + (btnH / 2), Graphics.FONT_XTINY, "+1", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, rowY + (6.0 * s).toNumber(), Graphics.FONT_XTINY, mts.toString() + " mts · " + activeKcal.toString() + " kcal", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(0x8E96A4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, rowY + (20.0 * s).toNumber(), Graphics.FONT_XTINY, "TANDA " + currentEnd.toString() + " · " + distanceM.toString() + " M", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 1) {
            drawArchery101010Header(dc, w, s, "TANDA " + currentEnd.toString() + "/" + endsCount.toString() + " · " + totalScore.toString() + " PTS");

            // 6 Tactile Score Keys (2x3) for Touch + Physical Highlight
            var padW = (160.0 * s).toNumber();
            var kGap = (5.0 * s).toNumber();
            var keyW = (padW - (2 * kGap)) / 3;
            var keyH = (28.0 * s).toNumber();
            var kStartX = cx - (padW / 2);
            var kStartY = (78.0 * s).toNumber();

            for (var k = 0; k < 6; k++) {
                var r = k / 3;
                var c = k % 3;
                var kx = kStartX + c * (keyW + kGap);
                var ky = kStartY + r * (keyH + kGap);
                var isSel = (k == selectedScoreIdx);

                dc.setColor(k < 3 ? 0x121107 : (k < 5 ? 0x160708 : 0x0B0E15), Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(kx, ky, keyW, keyH, (6.0 * s).toNumber());
                dc.setColor(isSel ? 0x00A8F3 : (k < 3 ? 0xFFE500 : (k < 5 ? 0xFF1E1E : 0x475569)), Graphics.COLOR_TRANSPARENT);
                dc.drawRoundedRectangle(kx, ky, keyW, keyH, (6.0 * s).toNumber());

                dc.setColor(k < 3 ? 0xFFE500 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(kx + (keyW / 2), ky + (keyH / 2), Graphics.FONT_SMALL, scoreLabels[k], Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Bottom Actions: BORRAR | SIG. TANDA
            var actY = (146.0 * s).toNumber();
            var actW = (padW - kGap) / 2;
            var actH = (22.0 * s).toNumber();

            dc.setColor(0x0B0E15, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(kStartX, actY, actW, actH, actH / 2);
            dc.setColor(0x475569, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(kStartX, actY, actW, actH, actH / 2);
            dc.setColor(0xCBD5E1, Graphics.COLOR_TRANSPARENT);
            dc.drawText(kStartX + (actW / 2), actY + (actH / 2), Graphics.FONT_XTINY, "BORRAR", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var nextX = kStartX + actW + kGap;
            dc.setColor(0x061523, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(nextX, actY, actW, actH, actH / 2);
            dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(nextX, actY, actW, actH, actH / 2);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(nextX + (actW / 2), actY + (actH / 2), Graphics.FONT_XTINY, "SIG. TANDA", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else if (screenIdx == 2) {
            drawArchery101010Header(dc, w, s, "GPS ACTIVO · PASOS");

            var cardW = (164.0 * s).toNumber();
            var cardH = (40.0 * s).toNumber();
            var cardX = cx - (cardW / 2);
            var card1Y = (76.0 * s).toNumber();
            var card2Y = (122.0 * s).toNumber();

            dc.setColor(0x07090E, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(cardX, card1Y, cardW, cardH, (9.0 * s).toNumber());
            dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(cardX, card1Y, cardW, cardH, (9.0 * s).toNumber());
            dc.setColor(0x8E96A4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card1Y + (11.0 * s).toNumber(), Graphics.FONT_XTINY, "DISTANCIA RECORRIDA", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card1Y + (27.0 * s).toNumber(), Graphics.FONT_SMALL, mtsFtStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            dc.setColor(0x07090E, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(cardX, card2Y, cardW, cardH, (9.0 * s).toNumber());
            dc.setColor(0xFF1E1E, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(cardX, card2Y, cardW, cardH, (9.0 * s).toNumber());
            dc.setColor(0x8E96A4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card2Y + (11.0 * s).toNumber(), Graphics.FONT_XTINY, "GASTO ENERGÉTICO", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, card2Y + (27.0 * s).toNumber(), Graphics.FONT_SMALL, activeKcal.toString() + " kcal", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            dc.setColor(0x8E96A4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (176.0 * s).toNumber(), Graphics.FONT_XTINY, arrowsCount.toString() + " FL · " + bowPoundageLbs.toString() + " LBS · SYNC", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        } else {
            drawArchery101010Header(dc, w, s, "SINCRONIZADO CON COACH");

            var sumW = (164.0 * s).toNumber();
            var sumX = cx - (sumW / 2);
            var sumY = (78.0 * s).toNumber();
            var sumH = (68.0 * s).toNumber();

            dc.setColor(0x07090E, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(sumX, sumY, sumW, sumH, (10.0 * s).toNumber());
            dc.setColor(0xFFE500, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(sumX, sumY, sumW, sumH, (10.0 * s).toNumber());

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, sumY + (22.0 * s).toNumber(), Graphics.FONT_SMALL, arrowsCount.toString() + " FL · " + totalScore.toString() + " PTS", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(0xFFE500, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, sumY + (48.0 * s).toNumber(), Graphics.FONT_XTINY, mtsFtStr + " · " + activeKcal.toString() + " kcal", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            var ctaW = (152.0 * s).toNumber();
            var ctaH = (24.0 * s).toNumber();
            var ctaX = cx - (ctaW / 2);
            var ctaY = (156.0 * s).toNumber();
            dc.setColor(0x061523, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(ctaX, ctaY, ctaW, ctaH, ctaH / 2);
            dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(ctaX, ctaY, ctaW, ctaH, ctaH / 2);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, ctaY + (ctaH / 2), Graphics.FONT_XTINY, "ENVIAR A COACH", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        drawPagerDots(dc, w, h, s);
    }
}

class Archery101010WatchDelegate extends WatchUi.BehaviorDelegate {
    private var mView;

    function initialize(view) {
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
            mView.syncWithPhoneApp("FINISH_SESSION_FROM_WATCH", null);
        }
        return true;
    }

    function onNextPage() {
        mView.screenIdx = (mView.screenIdx + 1) % 4;
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() {
        mView.screenIdx = (mView.screenIdx + 3) % 4;
        WatchUi.requestUpdate();
        return true;
    }

    function onMenu() {
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
        if (ty >= (h - (30.0 * s))) {
            mView.screenIdx = (mView.screenIdx + 1) % 4;
            WatchUi.requestUpdate();
            return true;
        }

        // Top pill tap on Screen 0 cycles sensitivity
        if (mView.screenIdx == 0 && ty <= (68.0 * s)) {
            mView.cycleSensitivityMode();
            return true;
        }

        if (mView.screenIdx == 0) {
            // Bottom row -1 / +1 buttons
            if (ty >= (146.0 * s) && ty <= (186.0 * s)) {
                if (tx < (cx - (36.0 * s))) {
                    if (mView.arrowsCount > 0) {
                        mView.incrementArrow(-1, false);
                    }
                    return true;
                } else if (tx > (cx + (36.0 * s))) {
                    mView.incrementArrow(1, false);
                    return true;
                }
            }
            // Tap on 4-digit counter increments +1
            if (ty >= (76.0 * s) && ty <= (140.0 * s)) {
                mView.incrementArrow(1, false);
                return true;
            }
        } else if (mView.screenIdx == 1) {
            var padW = 160.0 * s;
            var kGap = 5.0 * s;
            var keyW = (padW - (2.0 * kGap)) / 3.0;
            var keyH = 28.0 * s;
            var kStartX = cx - (padW / 2.0);
            var kStartY = 78.0 * s;

            for (var k = 0; k < 6; k++) {
                var r = k / 3;
                var c = k % 3;
                var kx = kStartX + c * (keyW + kGap);
                var ky = kStartY + r * (keyH + kGap);
                if (tx >= kx && tx <= (kx + keyW) && ty >= ky && ty <= (ky + keyH)) {
                    mView.selectedScoreIdx = k;
                    mView.recordScoreInput(mView.scoreLabels[k]);
                    return true;
                }
            }

            // Bottom BORRAR | SIG. TANDA touch buttons
            if (ty >= (142.0 * s) && ty <= (174.0 * s)) {
                if (tx < cx) {
                    mView.undoLastScore();
                } else {
                    mView.advanceNextEnd();
                }
                return true;
            }
        } else if (mView.screenIdx == 3) {
            if (ty >= (150.0 * s) && ty <= (186.0 * s)) {
                mView.syncWithPhoneApp("FINISH_SESSION_FROM_WATCH", null);
                return true;
            }
        }
        return false;
    }

    function onBack() {
        if (mView.screenIdx == 0 && mView.arrowsCount > 0) {
            mView.incrementArrow(-1, false);
            return true;
        } else if (mView.screenIdx == 1) {
            mView.selectedScoreIdx = (mView.selectedScoreIdx + 1) % 6;
            WatchUi.requestUpdate();
            return true;
        }
        return false;
    }
}

class CommListener extends Communications.ConnectionListener {
    function initialize() {
        ConnectionListener.initialize();
    }
    function onComplete() {}
    function onError() {}
}
