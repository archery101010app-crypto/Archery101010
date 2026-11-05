package com.archery101010.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Archery 101010 — Native Wear OS Watch App (Samsung Galaxy Watch, Pixel Watch, TicWatch, Xiaomi Watch)
 * Pure OLED #000000 predominance + ARCHERY 101010 tricolor header (#FFFFFF + #00A8F3 / #FF0000 / #FFF200)
 * 4 Screens:
 *  0: 4-Digit Mechanical Counter + Automatic Wrist Release Detector
 *  1: Quick Score Pad (X, 10, 9, 8, 7, M)
 *  2: Live Kcal + Walked Distance (0.00km/0.00mi)
 *  3: Session Summary & Save
 */
public class WearMainActivity extends Activity implements SensorEventListener {

    private static final String PREFS_NAME = "archery_101010_wear_prefs";

    private SensorManager sensorManager;
    private Sensor accelerometer;
    private Vibrator vibrator;

    private int screenIndex = 0; // 0..3
    private int arrowCount = 0;
    private boolean autoDetectEnabled = true;
    private long lastShotTimestamp = 0L;
    private long lastStepTimeMs = 0L;
    private long lastTelemetrySyncTimeMs = 0L;
    private double smoothedAccelMag = SensorManager.GRAVITY_EARTH;

    // Scoring state (synchronized with phone)
    private int currentEnd = 1;
    private int syncedArrowsPerEnd = 6;
    private int syncedEndsCount = 12;
    private int syncedActiveKcal = -1;
    private int syncedArrowsCount = 0;
    private float syncedWalkedMeters = 0f;
    private final List<String> currentEndArrows = new ArrayList<>();
    private int totalScore = 0;
    private int totalScoredArrows = 0;

    // Biometrics state (real GPS & steps only — never derived from arrow ends)
    private int stepsCount = 0;
    private int lastSyncedStepsCount = 0;
    private float distanceWalkedM = 0f;
    private int distanceMeters = 50;
    private float drawWeightLbs = 38f;

    private MessageClient.OnMessageReceivedListener messageListener = null;
    private final Handler heartbeatHandler = new Handler(Looper.getMainLooper());
    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            sendToPhone("{\"type\":\"REQUEST_STATE\"}");
            if (stepsCount > lastSyncedStepsCount) {
                syncTelemetryToPhone();
            }
            heartbeatHandler.postDelayed(this, 4000L);
        }
    };

    private WearCanvasView canvasView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        arrowCount = prefs.getInt("arrowCount", 0);
        totalScore = prefs.getInt("totalScore", 0);
        totalScoredArrows = prefs.getInt("totalScoredArrows", 0);
        currentEnd = prefs.getInt("currentEnd", 1);
        stepsCount = prefs.getInt("stepsCount", 0);
        distanceWalkedM = prefs.getFloat("walkedMeters", 0f);
        syncedArrowsPerEnd = Math.max(1, prefs.getInt("syncedArrowsPerEnd", 6));
        syncedEndsCount = Math.max(1, prefs.getInt("syncedEndsCount", 12));

        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

        canvasView = new WearCanvasView(this);
        setContentView(canvasView);

        initWearCommunication();
    }

    private void initWearCommunication() {
        try {
            if (messageListener != null) {
                Wearable.getMessageClient(this).removeListener(messageListener);
            }
            messageListener = (MessageEvent event) -> {
                if (event == null || event.getPath() == null) return;
                String path = event.getPath();
                if (path.startsWith("/archery101010/")) {
                    String jsonStr = new String(event.getData(), StandardCharsets.UTF_8);
                    handleIncomingPhonePayload(jsonStr);
                }
            };
            Wearable.getMessageClient(this).addListener(messageListener);
            // Request latest state from phone on startup
            sendToPhone("{\"type\":\"REQUEST_STATE\"}");
        } catch (Exception ignored) {}
    }

    private void handleIncomingPhonePayload(String json) {
        if (json == null || json.isEmpty()) return;
        try {
            JSONObject obj = new JSONObject(json);
            if (obj.has("payload") && obj.optJSONObject("payload") != null) {
                obj = obj.optJSONObject("payload");
            }
            if (obj.has("arrowsCount")) {
                arrowCount = obj.optInt("arrowsCount", arrowCount);
                syncedArrowsCount = arrowCount;
                totalScoredArrows = arrowCount;
            }
            if (obj.has("totalScore")) {
                totalScore = Math.max(0, obj.optInt("totalScore", totalScore));
            }
            if (obj.has("activeKcal")) {
                syncedActiveKcal = obj.optInt("activeKcal", -1);
            }
            if (obj.has("arrowsPerEnd")) {
                syncedArrowsPerEnd = Math.max(1, obj.optInt("arrowsPerEnd", 6));
            }
            if (obj.has("endsCount")) {
                syncedEndsCount = Math.max(1, obj.optInt("endsCount", 12));
            }
            if (obj.has("currentEndIndex")) {
                int nextEnd = obj.optInt("currentEndIndex", 0) + 1;
                if (nextEnd != currentEnd) {
                    currentEnd = nextEnd;
                    currentEndArrows.clear();
                }
            }
            if (obj.has("currentEndArrows")) {
                JSONArray arr = obj.optJSONArray("currentEndArrows");
                if (arr != null) {
                    currentEndArrows.clear();
                    for (int i = 0; i < arr.length() && currentEndArrows.size() < syncedArrowsPerEnd; i++) {
                        String val = arr.optString(i, "");
                        if (val != null && !val.isEmpty()) {
                            currentEndArrows.add(val);
                        }
                    }
                }
            }
            if (obj.has("stepsCount")) {
                stepsCount = Math.max(stepsCount, obj.optInt("stepsCount", stepsCount));
            }
            if (obj.has("distanceWalkedM") || obj.has("stepsCount")) {
                float incomingDist = (float) obj.optDouble("distanceWalkedM", distanceWalkedM);
                distanceWalkedM = Math.max(Math.max(distanceWalkedM, incomingDist), stepsCount * 0.76f);
                syncedWalkedMeters = distanceWalkedM;
            }
            if (obj.has("distanceM")) {
                distanceMeters = obj.optInt("distanceM", distanceMeters);
            }
            if (obj.has("bowPoundageLbs")) {
                drawWeightLbs = (float) obj.optDouble("bowPoundageLbs", drawWeightLbs);
            }
            if (obj.has("autoDetectEnabled")) {
                autoDetectEnabled = obj.optBoolean("autoDetectEnabled", autoDetectEnabled);
            }
            saveState();
            runOnUiThread(() -> {
                if (canvasView != null) canvasView.invalidate();
            });
        } catch (Exception ignored) {}
    }

    private void sendToPhone(String jsonPayload) {
        sendToPhone("/archery101010/command", jsonPayload);
    }

    private void sendToPhone(String path, String jsonPayload) {
        try {
            byte[] data = jsonPayload != null ? jsonPayload.getBytes(StandardCharsets.UTF_8) : new byte[0];
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                if (nodes != null) {
                    for (Node node : nodes) {
                        Wearable.getMessageClient(this).sendMessage(node.getId(), path, data);
                    }
                }
            });
        } catch (Exception ignored) {}
    }

    private void syncTelemetryToPhone() {
        try {
            lastSyncedStepsCount = stepsCount;
            lastTelemetrySyncTimeMs = System.currentTimeMillis();
            JSONObject payload = new JSONObject();
            payload.put("stepsCount", stepsCount);
            payload.put("distanceWalkedM", Math.round(getEffectiveWalkedMeters()));
            payload.put("activeKcal", getActiveKcal());

            JSONObject cmd = new JSONObject();
            cmd.put("type", "SYNC_TELEMETRY_FROM_WATCH");
            cmd.put("payload", payload);
            cmd.put("stepsCount", stepsCount);
            cmd.put("distanceWalkedM", Math.round(getEffectiveWalkedMeters()));
            sendToPhone(cmd.toString());
        } catch (Exception ignored) {}
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (sensorManager != null && accelerometer != null) {
            sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
        }
        heartbeatHandler.removeCallbacks(heartbeatRunnable);
        heartbeatHandler.postDelayed(heartbeatRunnable, 4000L);
    }

    @Override
    protected void onPause() {
        super.onPause();
        heartbeatHandler.removeCallbacks(heartbeatRunnable);
        if (sensorManager != null) {
            sensorManager.unregisterListener(this);
        }
        saveState();
    }

    @Override
    protected void onDestroy() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable);
        if (messageListener != null) {
            try {
                Wearable.getMessageClient(this).removeListener(messageListener);
                messageListener = null;
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    private void saveState() {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        editor.putInt("arrowCount", arrowCount);
        editor.putInt("totalScore", totalScore);
        editor.putInt("totalScoredArrows", totalScoredArrows);
        editor.putInt("currentEnd", currentEnd);
        editor.putInt("stepsCount", stepsCount);
        editor.putFloat("walkedMeters", getEffectiveWalkedMeters());
        editor.putInt("syncedArrowsPerEnd", syncedArrowsPerEnd);
        editor.putInt("syncedEndsCount", syncedEndsCount);
        editor.apply();
    }

    private void triggerHaptic(int durationMs) {
        if (vibrator == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(durationMs);
            }
        } catch (Exception ignored) {
        }
    }

    private float getEffectiveWalkedMeters() {
        return Math.max(0f, Math.max(distanceWalkedM, stepsCount * 0.76f));
    }

    private int getActiveKcal() {
        int arrowsShot = Math.max(arrowCount, totalScoredArrows);
        float walkedM = getEffectiveWalkedMeters();
        if (arrowsShot <= 0 && walkedM < 10f) {
            return syncedActiveKcal > 0 ? syncedActiveKcal : 0;
        }
        double kcalPerArrow = 0.56 + (Math.max(15, drawWeightLbs) * 0.0165);
        double walkKcal = (walkedM / 1000.0) * 72.0 * 0.98;
        if (syncedActiveKcal >= 0) {
            int localArrowDelta = Math.max(0, arrowsShot - syncedArrowsCount);
            float localWalkDelta = Math.max(0f, walkedM - syncedWalkedMeters);
            int localDeltaKcal = (int) Math.round(
                (localArrowDelta * kcalPerArrow) + ((localWalkDelta / 1000.0) * 72.0 * 0.98)
            );
            return syncedActiveKcal + localDeltaKcal;
        }
        return (int) Math.round((arrowsShot * kcalPerArrow) + walkKcal);
    }

    private String getFormattedKmAndMi() {
        float meters = getEffectiveWalkedMeters();
        float km = meters / 1000f;
        float mi = km * 0.621371f;
        return String.format(Locale.US, "%.2fkm/%.2fmi", km, mi);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
            float ax = event.values[0];
            float ay = event.values[1];
            float az = event.values[2];
            double mag = Math.sqrt(ax * ax + ay * ay + az * az);
            double dynamicLinear = mag - smoothedAccelMag;
            smoothedAccelMag = 0.96 * smoothedAccelMag + 0.04 * mag;
            double linearMag = Math.abs(mag - SensorManager.GRAVITY_EARTH);
            long now = System.currentTimeMillis();
            // Bow release signature on wrist (> 13.5 m/s^2 linear spike with 2.4s cooldown)
            if (autoDetectEnabled && linearMag >= 13.5 && (now - lastShotTimestamp) > 2400L) {
                lastShotTimestamp = now;
                arrowCount++;
                triggerHaptic(55);
                saveState();
                sendToPhone("{\"type\":\"INCREMENT_ARROW\",\"delta\":1,\"source\":\"watch_auto\"}");
                if (canvasView != null) canvasView.invalidate();
            } else if (dynamicLinear >= 1.15 && dynamicLinear <= 14.0 && (now - lastStepTimeMs) > 350L && (now - lastShotTimestamp) > 1200L) {
                // Walking cadence detected via gravity-isolated accelerometer (zero health permissions required)
                lastStepTimeMs = now;
                stepsCount++;
                distanceWalkedM = Math.max(distanceWalkedM + 0.76f, stepsCount * 0.76f);
                saveState();
                if ((now - lastTelemetrySyncTimeMs) >= 2500L) {
                    syncTelemetryToPhone();
                }
                if (canvasView != null) canvasView.invalidate();
            }
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    private class WearCanvasView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();
        private final GestureDetector gestureDetector;

        // Interactive hitboxes
        private final RectF btnLeftPrimary = new RectF();
        private final RectF btnRightSecondary = new RectF();
        private final RectF btnToggleDetector = new RectF();
        private final RectF[] scoreButtons = new RectF[6];
        private final String[] scoreLabels = new String[]{"X", "10", "9", "8", "7", "M"};

        public WearCanvasView(Context context) {
            super(context);
            for (int i = 0; i < 6; i++) {
                scoreButtons[i] = new RectF();
            }
            setFocusable(true);
            setFocusableInTouchMode(true);

            gestureDetector = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
                @Override
                public boolean onDown(MotionEvent e) {
                    return true;
                }

                @Override
                public boolean onSingleTapUp(MotionEvent e) {
                    handleTap(e.getX(), e.getY());
                    return true;
                }

                @Override
                public boolean onFling(MotionEvent e1, MotionEvent e2, float velocityX, float velocityY) {
                    if (e1 == null || e2 == null) return false;
                    float dx = e2.getX() - e1.getX();
                    float dy = e2.getY() - e1.getY();
                    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
                        if (dx < 0) {
                            screenIndex = (screenIndex + 1) % 4;
                        } else {
                            screenIndex = (screenIndex + 3) % 4;
                        }
                        triggerHaptic(20);
                        invalidate();
                        return true;
                    }
                    return false;
                }
            });
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            return gestureDetector.onTouchEvent(event) || super.onTouchEvent(event);
        }

        private void handleTap(float x, float y) {
            int w = getWidth();
            int h = getHeight();

            // Bottom page indicator tap switches screen
            if (y > h * 0.87f) {
                screenIndex = (screenIndex + 1) % 4;
                triggerHaptic(20);
                invalidate();
                return;
            }

            if (screenIndex == 0) {
                if (btnToggleDetector.contains(x, y)) {
                    autoDetectEnabled = !autoDetectEnabled;
                    triggerHaptic(25);
                    sendToPhone("{\"type\":\"TOGGLE_AUTO_DETECT\",\"enabled\":" + autoDetectEnabled + "}");
                    invalidate();
                    return;
                }
                if (btnLeftPrimary.contains(x, y)) {
                    arrowCount++;
                    triggerHaptic(45);
                    saveState();
                    sendToPhone("{\"type\":\"INCREMENT_ARROW\",\"delta\":1,\"source\":\"watch_manual\"}");
                    invalidate();
                    return;
                }
                if (btnRightSecondary.contains(x, y)) {
                    if (arrowCount > 0) {
                        arrowCount--;
                        triggerHaptic(25);
                        saveState();
                        sendToPhone("{\"type\":\"DECREMENT_ARROW\",\"delta\":-1,\"source\":\"watch_manual\"}");
                        invalidate();
                    }
                    return;
                }
            } else if (screenIndex == 1) {
                for (int i = 0; i < 6; i++) {
                    if (scoreButtons[i].contains(x, y)) {
                        if (currentEndArrows.size() < syncedArrowsPerEnd) {
                            String val = scoreLabels[i];
                            currentEndArrows.add(val);
                            int pts = "X".equals(val) || "10".equals(val) ? 10 : ("M".equals(val) ? 0 : Integer.parseInt(val));
                            totalScore += pts;
                            totalScoredArrows++;
                            arrowCount = Math.max(arrowCount + 1, totalScoredArrows);
                            triggerHaptic(35);
                            saveState();
                            sendToPhone("{\"type\":\"SCORE_INPUT\",\"payload\":{\"value\":\"" + val + "\"}}");
                            invalidate();
                        }
                        return;
                    }
                }
                if (btnLeftPrimary.contains(x, y)) {
                    if (!currentEndArrows.isEmpty()) {
                        String removed = currentEndArrows.remove(currentEndArrows.size() - 1);
                        int pts = "X".equals(removed) || "10".equals(removed) ? 10 : ("M".equals(removed) ? 0 : Integer.parseInt(removed));
                        totalScore = Math.max(0, totalScore - pts);
                        totalScoredArrows = Math.max(0, totalScoredArrows - 1);
                        arrowCount = Math.max(0, arrowCount - 1);
                        triggerHaptic(25);
                        saveState();
                        sendToPhone("{\"type\":\"UNDO_ARROW\"}");
                        invalidate();
                    }
                    return;
                }
                if (btnRightSecondary.contains(x, y)) {
                    if (!currentEndArrows.isEmpty()) {
                        currentEndArrows.clear();
                        currentEnd = Math.min(syncedEndsCount, currentEnd + 1);
                        triggerHaptic(45);
                        saveState();
                        sendToPhone("{\"type\":\"NEXT_END\"}");
                        invalidate();
                    }
                    return;
                }
            } else if (screenIndex == 2) {
                if (btnLeftPrimary.contains(x, y)) {
                    triggerHaptic(25);
                    syncTelemetryToPhone();
                    sendToPhone("{\"type\":\"REQUEST_STATE\"}");
                    invalidate();
                    return;
                }
            } else if (screenIndex == 3) {
                if (btnLeftPrimary.contains(x, y)) {
                    // Finish session on phone first, then reset local watch counters
                    triggerHaptic(70);
                    sendToPhone("{\"type\":\"FINISH_SESSION_FROM_WATCH\"}");
                    arrowCount = 0;
                    totalScore = 0;
                    totalScoredArrows = 0;
                    currentEnd = 1;
                    currentEndArrows.clear();
                    stepsCount = 0;
                    lastSyncedStepsCount = 0;
                    distanceWalkedM = 0f;
                    syncedActiveKcal = -1;
                    syncedArrowsCount = 0;
                    syncedWalkedMeters = 0f;
                    saveState();
                    screenIndex = 0;
                    invalidate();
                }
            }
        }

        private void drawTricolorHeader(Canvas canvas, float cx, float topY, float scale) {
            paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            paint.setTextSize(15f * scale);

            String p0 = "ARCHERY ";
            String p1 = "10";
            String p2 = "10";
            String p3 = "10";

            float w0 = paint.measureText(p0);
            float w1 = paint.measureText(p1);
            float w2 = paint.measureText(p2);
            float w3 = paint.measureText(p3);
            float totalW = w0 + w1 + w2 + w3;
            float startX = cx - totalW / 2f;

            paint.setTextAlign(Paint.Align.LEFT);
            paint.setColor(Color.WHITE);
            canvas.drawText(p0, startX, topY, paint);

            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawText(p1, startX + w0, topY, paint);

            paint.setColor(Color.parseColor("#FF0000"));
            canvas.drawText(p2, startX + w0 + w1, topY, paint);

            paint.setColor(Color.parseColor("#FFF200"));
            canvas.drawText(p3, startX + w0 + w1 + w2, topY, paint);

            // Subtle tricolor underline bar
            float barW = 104f * scale;
            float barH = 2.2f * scale;
            float barX = cx - barW / 2f;
            float barY = topY + 5f * scale;
            paint.setShader(new LinearGradient(
                    barX, barY, barX + barW, barY,
                    new int[]{Color.parseColor("#00A8F3"), Color.parseColor("#FF0000"), Color.parseColor("#FFF200")},
                    null,
                    Shader.TileMode.CLAMP
            ));
            rect.set(barX, barY, barX + barW, barY + barH);
            canvas.drawRoundRect(rect, barH, barH, paint);
            paint.setShader(null);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int w = getWidth();
            int h = getHeight();
            float cx = w / 2f;
            float scale = Math.min(w, h) / 240f;

            // Pure OLED Black Background
            canvas.drawColor(Color.BLACK);

            // Subtle outer ring accent
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.5f * scale);
            paint.setColor(Color.parseColor("#18181D"));
            canvas.drawCircle(cx, h / 2f, Math.min(w, h) / 2f - 2f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            // Tricolor Header: ARCHERY 101010
            drawTricolorHeader(canvas, cx, 32f * scale, scale);

            if (screenIndex == 0) {
                drawCounterScreen(canvas, w, h, cx, scale);
            } else if (screenIndex == 1) {
                drawScorePadScreen(canvas, w, h, cx, scale);
            } else if (screenIndex == 2) {
                drawBiometricsScreen(canvas, w, h, cx, scale);
            } else {
                drawSummaryScreen(canvas, w, h, cx, scale);
            }

            // Bottom page dots (4 screens)
            float dotY = h - 14f * scale;
            float dotSpacing = 12f * scale;
            float startDotX = cx - (1.5f * dotSpacing);
            for (int i = 0; i < 4; i++) {
                if (i == screenIndex) {
                    paint.setColor(Color.parseColor("#00A8F3"));
                    canvas.drawCircle(startDotX + i * dotSpacing, dotY, 3.3f * scale, paint);
                } else {
                    paint.setColor(Color.parseColor("#33333A"));
                    canvas.drawCircle(startDotX + i * dotSpacing, dotY, 2.3f * scale, paint);
                }
            }
        }

        private void drawCounterScreen(Canvas canvas, int w, int h, float cx, float scale) {
            // Auto-Detector Pill
            float pillW = 148f * scale;
            float pillH = 20f * scale;
            btnToggleDetector.set(cx - pillW / 2f, 44f * scale, cx + pillW / 2f, 44f * scale + pillH);
            paint.setColor(Color.parseColor("#0A0A0E"));
            canvas.drawRoundRect(btnToggleDetector, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(autoDetectEnabled ? Color.parseColor("#00A8F3") : Color.parseColor("#33333A"));
            canvas.drawRoundRect(btnToggleDetector, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setColor(autoDetectEnabled ? Color.parseColor("#00A8F3") : Color.GRAY);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(9.5f * scale);
            canvas.drawText(autoDetectEnabled ? "● DETECTOR ACTIVO" : "○ DETECTOR PAUSADO", cx, 57.5f * scale, paint);

            // 4-Digit Mechanical Counter Housing
            String digits = String.format(Locale.US, "%04d", Math.min(9999, Math.max(0, arrowCount)));
            float slotW = 35f * scale;
            float slotH = 54f * scale;
            float gap = 5f * scale;
            float totalW = 4 * slotW + 3 * gap;
            float startX = cx - totalW / 2f;
            float topY = 74f * scale;

            for (int i = 0; i < 4; i++) {
                float sx = startX + i * (slotW + gap);
                rect.set(sx, topY, sx + slotW, topY + slotH);
                paint.setColor(Color.parseColor("#0A0A0D"));
                canvas.drawRoundRect(rect, 8f * scale, 8f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.4f * scale);
                paint.setColor(i == 3 ? Color.parseColor("#FFF200") : Color.parseColor("#2A2A32"));
                canvas.drawRoundRect(rect, 8f * scale, 8f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setColor(i == 3 ? Color.parseColor("#FFF200") : Color.WHITE);
                paint.setTextSize(34f * scale);
                paint.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
                canvas.drawText(String.valueOf(digits.charAt(i)), sx + slotW / 2f, topY + 39f * scale, paint);
            }

            paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            paint.setTextSize(9.5f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText("CONTADOR AUTOMÁTICO DE FLECHAS", cx, 144f * scale, paint);

            // Bottom Action Buttons: +1 FLECHA and DESHACER
            float btnW = 84f * scale;
            float btnH = 32f * scale;
            float btnY = 156f * scale;
            btnLeftPrimary.set(cx - btnW - 4f * scale, btnY, cx - 4f * scale, btnY + btnH);
            btnRightSecondary.set(cx + 4f * scale, btnY, cx + btnW + 4f * scale, btnY + btnH);

            paint.setColor(Color.parseColor("#0A1826"));
            canvas.drawRoundRect(btnLeftPrimary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            paint.setTextSize(10.5f * scale);
            canvas.drawText("+1 FLECHA", btnLeftPrimary.centerX(), btnY + 20f * scale, paint);

            paint.setColor(Color.parseColor("#1A0808"));
            canvas.drawRoundRect(btnRightSecondary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(Color.parseColor("#FF0000"));
            canvas.drawRoundRect(btnRightSecondary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            canvas.drawText("DESHACER", btnRightSecondary.centerX(), btnY + 20f * scale, paint);
        }

        private void drawScorePadScreen(Canvas canvas, int w, int h, float cx, float scale) {
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(9.5f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawText("RONDA " + currentEnd + "/" + syncedEndsCount + "  •  " + totalScore + " PTS", cx, 52f * scale, paint);

            // Dynamic Current Arrow Slots (syncedArrowsPerEnd, e.g., 3 or 6)
            int slotsCount = Math.max(1, Math.min(6, syncedArrowsPerEnd));
            float gap = (slotsCount <= 3 ? 6f : 3.5f) * scale;
            float totalSlotsW = 156f * scale;
            float slotW = (totalSlotsW - (slotsCount - 1) * gap) / slotsCount;
            float slotH = 28f * scale;
            float startX = cx - totalSlotsW / 2f;
            float slotY = 59f * scale;

            for (int i = 0; i < slotsCount; i++) {
                float sx = startX + i * (slotW + gap);
                rect.set(sx, slotY, sx + slotW, slotY + slotH);
                String val = i < currentEndArrows.size() ? currentEndArrows.get(i) : "—";
                paint.setColor(Color.parseColor("#0C0C10"));
                canvas.drawRoundRect(rect, 7f * scale, 7f * scale, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.2f * scale);
                paint.setColor(i == currentEndArrows.size() ? Color.parseColor("#00A8F3") : Color.parseColor("#2A2A32"));
                canvas.drawRoundRect(rect, 7f * scale, 7f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setColor("X".equals(val) || "10".equals(val) || "9".equals(val) ? Color.parseColor("#FFF200") : Color.WHITE);
                paint.setTextSize((slotsCount <= 3 ? 14f : 11.5f) * scale);
                canvas.drawText(val, rect.centerX(), slotY + 19f * scale, paint);
            }

            // 6 Keypad Buttons (2 rows x 3 cols): X, 10, 9 / 8, 7, M
            float keyW = 50f * scale;
            float keyH = 30f * scale;
            float kGap = 6f * scale;
            float kStartX = cx - (3 * keyW + 2 * kGap) / 2f;
            float kStartY = 93f * scale;

            for (int i = 0; i < 6; i++) {
                int row = i / 3;
                int col = i % 3;
                float kx = kStartX + col * (keyW + kGap);
                float ky = kStartY + row * (keyH + kGap);
                scoreButtons[i].set(kx, ky, kx + keyW, ky + keyH);

                if (i < 3) {
                    paint.setColor(Color.parseColor("#FFF200"));
                } else if (i < 5) {
                    paint.setColor(Color.parseColor("#FF0000"));
                } else {
                    paint.setColor(Color.parseColor("#1E1E24"));
                }
                canvas.drawRoundRect(scoreButtons[i], 8f * scale, 8f * scale, paint);

                paint.setColor(i < 3 ? Color.BLACK : Color.WHITE);
                paint.setTextSize(14f * scale);
                canvas.drawText(scoreLabels[i], scoreButtons[i].centerX(), ky + 20f * scale, paint);
            }

            // Bottom row: BORRAR and SIG. RONDA
            float btnW = 78f * scale;
            float btnH = 26f * scale;
            float btnY = 165f * scale;
            btnLeftPrimary.set(cx - btnW - 4f * scale, btnY, cx - 4f * scale, btnY + btnH);
            btnRightSecondary.set(cx + 4f * scale, btnY, cx + btnW + 4f * scale, btnY + btnH);

            paint.setColor(Color.parseColor("#16161C"));
            canvas.drawRoundRect(btnLeftPrimary, 8f * scale, 8f * scale, paint);
            paint.setColor(Color.WHITE);
            paint.setTextSize(9.5f * scale);
            canvas.drawText("BORRAR", btnLeftPrimary.centerX(), btnY + 16.5f * scale, paint);

            paint.setColor(Color.parseColor("#0A1826"));
            canvas.drawRoundRect(btnRightSecondary, 8f * scale, 8f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnRightSecondary, 8f * scale, 8f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawText("SIG. RONDA →", btnRightSecondary.centerX(), btnY + 16.5f * scale, paint);
        }

        private void drawBiometricsScreen(Canvas canvas, int w, int h, float cx, float scale) {
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(9.5f * scale);
            paint.setColor(Color.parseColor("#FFF200"));
            canvas.drawText("TELEMETRÍA DE CAMPO Y ENERGÍA", cx, 52f * scale, paint);

            // Card 1: KCAL
            float cardW = 168f * scale;
            float cardH = 44f * scale;
            rect.set(cx - cardW / 2f, 60f * scale, cx + cardW / 2f, 60f * scale + cardH);
            paint.setColor(Color.parseColor("#0B0B0F"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(Color.parseColor("#FF0000"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTextSize(9f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText("KCAL", cx, 75f * scale, paint);
            paint.setTextSize(19f * scale);
            paint.setColor(Color.parseColor("#FFF200"));
            canvas.drawText(getActiveKcal() + " kcal", cx, 96f * scale, paint);

            // Card 2: DISTANCIA RECORRIDA (0.00km/0.00mi)
            rect.set(cx - cardW / 2f, 110f * scale, cx + cardW / 2f, 110f * scale + cardH);
            paint.setColor(Color.parseColor("#0B0B0F"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTextSize(9f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText("DISTANCIA RECORRIDA", cx, 125f * scale, paint);
            paint.setTextSize(16f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText(getFormattedKmAndMi(), cx, 146f * scale, paint);

            // Live GPS + Steps telemetry sync pill (no manual round-based distance addition)
            btnLeftPrimary.set(cx - 76f * scale, 161f * scale, cx + 76f * scale, 187f * scale);
            paint.setColor(Color.parseColor("#0A1826"));
            canvas.drawRoundRect(btnLeftPrimary, 8f * scale, 8f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, 8f * scale, 8f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(8.8f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawText("GPS + PASOS EN VIVO • AUTO", cx, 177.5f * scale, paint);
        }

        private void drawSummaryScreen(Canvas canvas, int w, int h, float cx, float scale) {
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(9.5f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawText("RESUMEN DE SESIÓN", cx, 52f * scale, paint);

            paint.setTextSize(28f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText(totalScore + " PTS", cx, 84f * scale, paint);

            paint.setTextSize(11f * scale);
            paint.setColor(Color.parseColor("#FFF200"));
            canvas.drawText(arrowCount + " FLECHAS  •  " + getActiveKcal() + " KCAL", cx, 106f * scale, paint);

            paint.setTextSize(11f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawText(getFormattedKmAndMi(), cx, 126f * scale, paint);

            btnLeftPrimary.set(cx - 78f * scale, 145f * scale, cx + 78f * scale, 180f * scale);
            paint.setColor(Color.parseColor("#0A1826"));
            canvas.drawRoundRect(btnLeftPrimary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.5f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTextSize(10.5f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText("GUARDAR Y REINICIAR", cx, 166.5f * scale, paint);
        }
    }
}
