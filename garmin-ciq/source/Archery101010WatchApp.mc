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
    public var selectedScoreIdx = 0; // 0:X, 1:10, 2:9, 3:8, 4:7, 5:M
    public var scoreLabels = ["X", "10", "9", "8", "7", "M"];
    public var currentEndArrows = [];

    private var mLastLat = null;
    private var mLastLon = null;
    private var mLastShotMs = 0;
    private var mBaselineSteps = null;

    function initialize() {
        View.initialize();
        if (Toybox has :ActivityMonitor) {
            var monInfo = Toybox.ActivityMonitor.getInfo();
            if (monInfo != null && monInfo has :steps && monInfo.steps != null) {
                mBaselineSteps = monInfo.steps;
            }
        }
        var timer = new Toybox.Timer.Timer();
        timer.start(method(:onSensorTick), 80, true);
    }

    function onSensorTick() as Void {
        if (!autoDetectEnabled) {
            return;
        }
        var info = Sensor.getInfo();
        if (info has :accel && info.accel != null) {
            var ax = info.accel[0];
            var ay = info.accel[1];
            var az = info.accel[2];
            var magMg = Math.sqrt(ax * ax + ay * ay + az * az);
            var deltaMg = (magMg - 1000.0).abs();

            var now = System.getTimer();
            if (deltaMg >= 2100.0 && (now - mLastShotMs) > 2600) {
                mLastShotMs = now;
                incrementArrow(1, true);
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
            "autoDetectEnabled" => autoDetectEnabled
        };
        if (scoreVal != null) {
            payload["value"] = scoreVal;
        }
        Communications.transmit(payload, null, new CommListener());
    }

    function drawArchery101010Header(dc as Graphics.Dc, w as Lang.Number, statusLabel as Lang.String) as Void {
        var cx = w / 2;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx - 28, 16, Graphics.FONT_XTINY, "ARCHERY", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + 18, 16, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0xFF1E1E, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + 34, 16, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0xFFE500, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + 50, 16, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 35, Graphics.FONT_XTINY, statusLabel, Graphics.TEXT_JUSTIFY_CENTER);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        recalculateMetrics();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var cy = h / 2;

        // Matte OLED Black Background
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var mts = distanceWalkedM;
        var ft = (distanceWalkedM * 3.28084).toNumber();
        var mtsFtStr = mts.toString() + " mts · " + ft.toString() + " ft";

        if (screenIdx == 0) {
            drawArchery101010Header(dc, w, autoDetectEnabled ? "AUTO-TIRO · LIVE" : "MODO MANUAL");

            var d3 = (arrowsCount / 1000) % 10;
            var d2 = (arrowsCount / 100) % 10;
            var d1 = (arrowsCount / 10) % 10;
            var d0 = arrowsCount % 10;
            var digits = [d3, d2, d1, d0];

            var boxW = 40;
            var boxH = 56;
            var gap = 5;
            var totalW = (boxW * 4) + (gap * 3);
            var startX = cx - (totalW / 2);
            var startY = cy - (boxH / 2) - 4;

            for (var i = 0; i < 4; i++) {
                var rx = startX + i * (boxW + gap);
                dc.setColor(0x0B0E15, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(rx, startY, boxW, boxH, 7);
                dc.setColor(i == 3 ? 0xFFE500 : 0x2A2F3A, Graphics.COLOR_TRANSPARENT);
                dc.drawRoundedRectangle(rx, startY, boxW, boxH, 7);

                dc.setColor(i == 3 ? 0xFFE500 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(rx + (boxW / 2), startY + (boxH / 2), Graphics.FONT_NUMBER_MEDIUM, digits[i].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h - 54, Graphics.FONT_XTINY, mts.toString() + " mts · " + activeKcal.toString() + " kcal", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x8E96A4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h - 36, Graphics.FONT_XTINY, "TANDA " + currentEnd.toString() + " · " + distanceM.toString() + " M", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (screenIdx == 1) {
            drawArchery101010Header(dc, w, "TANDA " + currentEnd.toString() + "/" + endsCount.toString() + " · " + totalScore.toString() + " PTS");

            var selVal = scoreLabels[selectedScoreIdx];
            dc.setColor(0xFFE500, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 18, Graphics.FONT_MEDIUM, "MARCAR: " + selVal, Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x8E96A4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 18, Graphics.FONT_XTINY, "SELECT = ANOTAR · BACK = CAMBIAR", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (screenIdx == 2) {
            drawArchery101010Header(dc, w, "GPS · PASOS EN VIVO");

            dc.setColor(0x8E96A4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 40, Graphics.FONT_XTINY, "DISTANCIA RECORRIDA", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 20, Graphics.FONT_SMALL, mtsFtStr, Graphics.TEXT_JUSTIFY_CENTER);

            dc.setColor(0x8E96A4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 12, Graphics.FONT_XTINY, "GASTO ENERGÉTICO", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 32, Graphics.FONT_SMALL, activeKcal.toString() + " kcal", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            drawArchery101010Header(dc, w, "RESUMEN DE SESIÓN");
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 26, Graphics.FONT_SMALL, arrowsCount.toString() + " FL · " + totalScore.toString() + " PTS", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0xFFE500, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 2, Graphics.FONT_XTINY, mtsFtStr + " · " + activeKcal.toString() + " kcal", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 32, Graphics.FONT_XTINY, "SELECT = ENVIAR A COACH", Graphics.TEXT_JUSTIFY_CENTER);
        }
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
