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
 * ARCHERY 101010 — Garmin Connect IQ Open Smartwatch Mini-App
 * Features:
 * 1. "ARCHERY 101010" Official Tricolor Header (#FFFFFF + #00A8F3, #FF0000, #FFF200) on all 4 screens
 * 2. 4-Digit Mechanical Drum Counter (0 0 0 0) with active Gold Reel (#FFF200)
 * 3. Automatic Bow Release Detector via 25Hz Wrist Accelerometer Impulse + Haptic Vibe
 * 4. High-Precision GPS Distance Tracker (km / mi) + Automatic Range Walk Fallback
 * 5. Active Kcal Calculator (Bow Poundage + Range Walking) & Instant Phone/Coach Sync
 */
class Archery101010WatchApp extends Application.AppBase {
    hidden var mView;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
    }

    function onStop(state) {
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
    }

    function onPosition(info as Position.Info) as Void {
        if (mView != null) {
            mView.updateGpsPosition(info);
        }
    }

    function getInitialView() {
        mView = new Archery101010WatchView();
        var delegate = new Archery101010WatchDelegate(mView);
        return [ mView, delegate ];
    }
}

class Archery101010WatchView extends WatchUi.View {
    public var screenIdx = 0; // 0: Mechanical Counter, 1: Distance+Kcal, 2: Auto-Shot Sensitivity, 3: Coach Sync
    public var arrowsCount = 0;
    public var distanceM = 50;
    public var arrowsPerEnd = 6;
    public var bowPoundageLbs = 38;
    public var gpsDistanceM = 0.0;
    public var distanceWalkedM = 0;
    public var activeKcal = 0;
    public var autoDetectEnabled = true;
    public var sensitivityLevel = 0; // 0: ALTA, 1: MEDIA, 2: BAJA
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
            var ax = info.accel[0]; // in milli-G
            var ay = info.accel[1];
            var az = info.accel[2];
            var magMg = Math.sqrt(ax * ax + ay * ay + az * az);
            var deltaMg = (magMg - 1000.0).abs();

            var thresholdMg = (sensitivityLevel == 0) ? 1850.0 : (sensitivityLevel == 1) ? 2250.0 : 2700.0;
            var now = System.getTimer();
            if (deltaMg >= thresholdMg && (now - mLastShotMs) > 3200) {
                mLastShotMs = now;
                incrementArrow(1, true);
            }
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
            var vibe = [new Attention.VibeProfile(isAuto ? 85 : 55, isAuto ? 120 : 60)];
            Attention.vibrate(vibe);
        }
        recalculateMetrics();
        syncWithPhoneApp("INCREMENT_ARROW");
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
        distanceWalkedM = distM.toNumber();

        var kcalPerArrow = 0.56 + (bowPoundageLbs * 0.0165);
        var bowKcal = arrowsCount * kcalPerArrow;
        var walkKcal = (distanceWalkedM / 1000.0) * 72.0 * 0.78;
        activeKcal = (bowKcal + walkKcal).toNumber();
    }

    function syncWithPhoneApp(eventType as Lang.String) as Void {
        var payload = {
            "type" => eventType,
            "arrowsCount" => arrowsCount,
            "distanceWalkedM" => distanceWalkedM,
            "activeKcal" => activeKcal,
            "autoDetectEnabled" => autoDetectEnabled
        };
        Communications.transmit(payload, null, new CommListener());
    }

    function drawArchery101010Header(dc as Graphics.Dc, w as Lang.Number, statusLabel as Lang.String) as Void {
        var cx = w / 2;
        // Top tricolor accent line
        dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(cx - 45, 6, 30, 3);
        dc.setColor(0xFF0000, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(cx - 15, 6, 30, 3);
        dc.setColor(0xFFF200, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(cx + 15, 6, 30, 3);

        // "ARCHERY 101010" Brand Header
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx - 28, 14, Graphics.FONT_XTINY, "ARCHERY", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + 18, 14, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0xFF0000, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + 34, 14, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0xFFF200, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + 50, 14, Graphics.FONT_XTINY, "10", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 34, Graphics.FONT_XTINY, statusLabel, Graphics.TEXT_JUSTIFY_CENTER);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        recalculateMetrics();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var cy = h / 2;

        // Pure OLED Black Background
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var km = distanceWalkedM / 1000.0;
        var mi = distanceWalkedM / 1609.344;
        var kmMiStr = km.format("%.2f") + "km / " + mi.format("%.2f") + "mi";

        if (screenIdx == 0) {
            drawArchery101010Header(dc, w, autoDetectEnabled ? "AUTO-TIRO ACTIVO" : "MODO MANUAL");

            // 4-Digit Mechanical Counter Drum (0 0 0 0)
            var d3 = (arrowsCount / 1000) % 10;
            var d2 = (arrowsCount / 100) % 10;
            var d1 = (arrowsCount / 10) % 10;
            var d0 = arrowsCount % 10;
            var digits = [d3, d2, d1, d0];

            var boxW = 42;
            var boxH = 62;
            var gap = 6;
            var totalW = (boxW * 4) + (gap * 3);
            var startX = cx - (totalW / 2);
            var startY = cy - (boxH / 2) - 4;

            for (var i = 0; i < 4; i++) {
                var rx = startX + i * (boxW + gap);
                dc.setColor(0x131822, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(rx, startY, boxW, boxH, 8);
                dc.setColor(i == 3 ? 0xFFF200 : 0x3A3D45, Graphics.COLOR_TRANSPARENT);
                dc.drawRoundedRectangle(rx, startY, boxW, boxH, 8);

                dc.setColor(i == 3 ? 0xFFF200 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(rx + (boxW / 2), startY + (boxH / 2), Graphics.FONT_NUMBER_MEDIUM, digits[i].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h - 52, Graphics.FONT_XTINY, km.format("%.2f") + "km · " + activeKcal.toString() + "kcal", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (screenIdx == 1) {
            drawArchery101010Header(dc, w, "GPS + PASOS REALES");

            dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 42, Graphics.FONT_XTINY, "DISTANCIA RECORRIDA", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 22, Graphics.FONT_SMALL, kmMiStr, Graphics.TEXT_JUSTIFY_CENTER);

            dc.setColor(0xFF0000, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 16, Graphics.FONT_XTINY, "KCAL", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 34, Graphics.FONT_MEDIUM, activeKcal.toString() + " kcal", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (screenIdx == 2) {
            drawArchery101010Header(dc, w, "SUELTA DETECTADA · +1");
            var sensLbl = (sensitivityLevel == 0) ? "SENSIBILIDAD: ALTA" : (sensitivityLevel == 1) ? "SENSIBILIDAD: MEDIA" : "SENSIBILIDAD: BAJA";
            dc.setColor(0xFFF200, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 16, Graphics.FONT_SMALL, "FLECHA #" + arrowsCount.toString(), Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 18, Graphics.FONT_XTINY, sensLbl, Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            drawArchery101010Header(dc, w, "SINCRONIZADO CON COACH");
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 28, Graphics.FONT_SMALL, arrowsCount.toString() + " FL · " + activeKcal.toString() + " kcal", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0xFFF200, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 4, Graphics.FONT_XTINY, kmMiStr, Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x00A8F3, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 34, Graphics.FONT_XTINY, "SELECT = ENVIAR A COACH", Graphics.TEXT_JUSTIFY_CENTER);
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
        if (mView.screenIdx == 3) {
            mView.syncWithPhoneApp("FINISH_SESSION_FROM_WATCH");
        } else {
            mView.incrementArrow(1, false);
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
