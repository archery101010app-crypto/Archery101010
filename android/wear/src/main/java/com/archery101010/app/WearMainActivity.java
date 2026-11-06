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
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataItemBuffer;
import com.google.android.gms.wearable.DataMap;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
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
    private PowerManager.WakeLock wakeLock;
    private boolean isSensorRegistered = false;

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

    // Connection & sync race-condition guards
    private volatile boolean isPhoneConnected = false;
    private volatile long lastPhoneSyncMs = 0L;
    private volatile long lastLocalActionTimeMs = 0L;
    private volatile long lastFinishedTimestampMs = 0L;
    private volatile String currentSessionId = "";
    private volatile String lastFinishedSessionId = "";
    private volatile long cmdSequence = 0L;
    private volatile long pendingCmdSeq = 0L;
    private volatile long lastAckedCmdSeq = 0L;

    private MessageClient.OnMessageReceivedListener messageListener = null;
    private DataClient.OnDataChangedListener dataListener = null;
    private final Handler heartbeatHandler = new Handler(Looper.getMainLooper());
    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            sendToPhone("{\"type\":\"REQUEST_STATE\"}");
            if (stepsCount > lastSyncedStepsCount) {
                syncTelemetryToPhone();
            }
            checkPhoneNodeConnectivity();
            heartbeatHandler.postDelayed(this, 4000L);
        }
    };

    private WearCanvasView canvasView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Archery101010::WearSessionWakeLock");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(4 * 60 * 60 * 1000L); // Keep sensors alive up to 4h when wrist is lowered
            }
        } catch (Exception ignored) {}

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        arrowCount = prefs.getInt("arrowCount", 0);
        totalScore = prefs.getInt("totalScore", 0);
        totalScoredArrows = prefs.getInt("totalScoredArrows", 0);
        currentEnd = prefs.getInt("currentEnd", 1);
        stepsCount = prefs.getInt("stepsCount", 0);
        distanceWalkedM = prefs.getFloat("walkedMeters", 0f);
        syncedArrowsPerEnd = Math.max(1, prefs.getInt("syncedArrowsPerEnd", 6));
        syncedEndsCount = Math.max(1, prefs.getInt("syncedEndsCount", 12));
        cmdSequence = prefs.getLong("cmdSequence", 0L);

        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

        canvasView = new WearCanvasView(this);
        setContentView(canvasView);

        ensureSensorAndHeartbeatActive();
        initWearCommunication();
    }

    private void ensureSensorAndHeartbeatActive() {
        if (sensorManager != null && accelerometer != null && !isSensorRegistered) {
            try {
                sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
                isSensorRegistered = true;
            } catch (Exception ignored) {}
        }
        heartbeatHandler.removeCallbacks(heartbeatRunnable);
        heartbeatHandler.postDelayed(heartbeatRunnable, 4000L);
    }

    private void checkPhoneNodeConnectivity() {
        try {
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                boolean hasNodes = nodes != null && !nodes.isEmpty();
                if (hasNodes != isPhoneConnected) {
                    isPhoneConnected = hasNodes;
                    runOnUiThread(() -> {
                        if (canvasView != null) canvasView.invalidate();
                    });
                }
            });
        } catch (Exception ignored) {}
    }

    private void initWearCommunication() {
        try {
            if (messageListener != null) {
                Wearable.getMessageClient(this).removeListener(messageListener);
            }
            messageListener = (MessageEvent event) -> {
                if (event == null || event.getPath() == null) return;
                String path = event.getPath();
                long now = System.currentTimeMillis();
                isPhoneConnected = true;
                lastPhoneSyncMs = now;

                if ("/archery101010/ping".equals(path)) {
                    byte[] pongBytes = ("{\"type\":\"PONG\",\"_ts\":" + now + "}").getBytes(StandardCharsets.UTF_8);
                    Wearable.getMessageClient(this).sendMessage(event.getSourceNodeId(), "/archery101010/pong", pongBytes);
                    runOnUiThread(() -> {
                        if (canvasView != null) canvasView.invalidate();
                    });
                    return;
                }
                if ("/archery101010/pong".equals(path)) {
                    runOnUiThread(() -> {
                        if (canvasView != null) canvasView.invalidate();
                    });
                    return;
                }
                if (path.startsWith("/archery101010/")) {
                    String jsonStr = event.getData() != null
                        ? new String(event.getData(), StandardCharsets.UTF_8)
                        : "";
                    handleIncomingPhonePayload(jsonStr);
                }
            };
            Wearable.getMessageClient(this).addListener(messageListener);
        } catch (Exception ignored) {}

        try {
            if (dataListener != null) {
                Wearable.getDataClient(this).removeListener(dataListener);
            }
            dataListener = (DataEventBuffer dataEvents) -> {
                if (dataEvents == null) return;
                for (DataEvent event : dataEvents) {
                    if (event.getType() == DataEvent.TYPE_CHANGED) {
                        DataItem item = event.getDataItem();
                        if (item != null && item.getUri() != null && "/archery101010/state".equals(item.getUri().getPath())) {
                            DataMap dataMap = DataMapItem.fromDataItem(item).getDataMap();
                            String snapshotJson = dataMap.getString("snapshot_json", "");
                            if (snapshotJson != null && !snapshotJson.isEmpty()) {
                                isPhoneConnected = true;
                                lastPhoneSyncMs = System.currentTimeMillis();
                                handleIncomingPhonePayload(snapshotJson);
                            }
                        }
                    }
                }
            };
            Wearable.getDataClient(this).addListener(dataListener);

            // Immediately read any persisted /archery101010/state DataItem on startup
            Wearable.getDataClient(this).getDataItems().addOnSuccessListener((DataItemBuffer dataItems) -> {
                if (dataItems == null) return;
                try {
                    for (DataItem item : dataItems) {
                        if (item != null && item.getUri() != null && "/archery101010/state".equals(item.getUri().getPath())) {
                            DataMap dataMap = DataMapItem.fromDataItem(item).getDataMap();
                            String snapshotJson = dataMap.getString("snapshot_json", "");
                            if (snapshotJson != null && !snapshotJson.isEmpty()) {
                                handleIncomingPhonePayload(snapshotJson);
                            }
                        }
                    }
                } finally {
                    dataItems.release();
                }
            });
        } catch (Exception ignored) {}

        checkPhoneNodeConnectivity();
        sendToPhone("/archery101010/ping", "{\"type\":\"PING\"}", false);
        sendToPhone("{\"type\":\"REQUEST_STATE\"}");
    }

    private void handleIncomingPhonePayload(String json) {
        if (json == null || json.isEmpty()) return;
        try {
            JSONObject rootObj = new JSONObject(json);
            long incomingAckSeq = rootObj.optLong("_ackCmdSeq", 0L);
            JSONObject obj = rootObj;
            if (rootObj.has("payload") && rootObj.optJSONObject("payload") != null) {
                obj = rootObj.optJSONObject("payload");
                incomingAckSeq = Math.max(incomingAckSeq, obj.optLong("_ackCmdSeq", 0L));
            }
            if (incomingAckSeq > lastAckedCmdSeq) {
                lastAckedCmdSeq = incomingAckSeq;
            }

            long now = System.currentTimeMillis();
            isPhoneConnected = true;
            lastPhoneSyncMs = now;

            String incomingSessionId = obj.optString("sessionId", "");
            int incomingArrows = obj.optInt("arrowsCount", -1);
            boolean sessionActive = obj.optBoolean("sessionActive", rootObj.optBoolean("sessionActive", true));

            // Guard 1: If the phone explicitly reports sessionActive == false (or 0 arrows after finish),
            // clear any finished-session lock and do not overwrite active local shots taken within the last 6s.
            if (!sessionActive) {
                if (incomingArrows <= 0) {
                    lastFinishedSessionId = "";
                }
                if ((now - lastLocalActionTimeMs) >= 6000L) {
                    arrowCount = 0;
                    syncedArrowsCount = 0;
                    totalScoredArrows = 0;
                    totalScore = 0;
                    currentEnd = 1;
                    currentEndArrows.clear();
                    saveState();
                    runOnUiThread(() -> {
                        if (canvasView != null) canvasView.invalidate();
                    });
                }
                return;
            }

            // Guard 2: Do not revive a session that was finished on the watch
            if (incomingArrows == 0) {
                lastFinishedSessionId = "";
            } else if (incomingArrows > 0) {
                if (!lastFinishedSessionId.isEmpty() && incomingSessionId.equals(lastFinishedSessionId)) {
                    return;
                }
                if ((now - lastFinishedTimestampMs) < 15000L && incomingSessionId.isEmpty()) {
                    return;
                }
            }
            if (!incomingSessionId.isEmpty()) {
                currentSessionId = incomingSessionId;
            }

            // Guard 3: If the user acted locally on the watch within the last 6s and the phone snapshot
            // has not yet acknowledged our latest command (_ackCmdSeq < pendingCmdSeq), keep local arrow/score state
            // intact in BOTH directions (protects both +1 increments AND DESHACER/BORRAR undos).
            boolean hasUnackedLocalAction =
                ((now - lastLocalActionTimeMs) < 6000L) &&
                (pendingCmdSeq == 0L || incomingAckSeq < pendingCmdSeq);

            if (obj.has("arrowsCount")) {
                if (hasUnackedLocalAction) {
                    syncedArrowsCount = Math.max(0, incomingArrows);
                } else {
                    arrowCount = Math.max(0, incomingArrows);
                    syncedArrowsCount = arrowCount;
                    totalScoredArrows = arrowCount;
                }
            }
            if (obj.has("totalScore") && !hasUnackedLocalAction) {
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
            if (obj.has("currentEndIndex") && !hasUnackedLocalAction) {
                int nextEnd = obj.optInt("currentEndIndex", 0) + 1;
                if (nextEnd != currentEnd) {
                    currentEnd = nextEnd;
                    currentEndArrows.clear();
                }
            }
            if (obj.has("currentEndArrows") && !hasUnackedLocalAction) {
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
            if (obj.has("autoDetectEnabled") && !hasUnackedLocalAction) {
                autoDetectEnabled = obj.optBoolean("autoDetectEnabled", autoDetectEnabled);
            }
            saveState();
            runOnUiThread(() -> {
                if (canvasView != null) canvasView.invalidate();
            });
        } catch (Exception ignored) {}
    }

    private void sendToPhone(String jsonPayload) {
        boolean isRequestState = jsonPayload != null && jsonPayload.contains("\"REQUEST_STATE\"");
        sendToPhone("/archery101010/command", jsonPayload, !isRequestState);
    }

    private void sendToPhone(String path, String jsonPayload, boolean persistViaDataClient) {
        try {
            String enrichedPayload = jsonPayload;
            long now = System.currentTimeMillis();
            if (persistViaDataClient && jsonPayload != null && jsonPayload.startsWith("{")) {
                try {
                    JSONObject obj = new JSONObject(jsonPayload);
                    long seq = ++cmdSequence;
                    String cmdId = now + "-" + seq;
                    obj.put("_cmdId", cmdId);
                    obj.put("_cmdSeq", seq);
                    obj.put("_ts", now);
                    String cmdType = obj.optString("type", "");
                    if (!"SYNC_TELEMETRY_FROM_WATCH".equals(cmdType)) {
                        pendingCmdSeq = seq;
                    }
                    enrichedPayload = obj.toString();
                    saveState();
                } catch (Exception ignored) {}
            }

            final byte[] data = enrichedPayload != null ? enrichedPayload.getBytes(StandardCharsets.UTF_8) : new byte[0];
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                if (nodes != null && !nodes.isEmpty()) {
                    isPhoneConnected = true;
                    for (Node node : nodes) {
                        Wearable.getMessageClient(this).sendMessage(node.getId(), path, data);
                    }
                } else {
                    isPhoneConnected = false;
                }
            });

            if (persistViaDataClient && enrichedPayload != null) {
                PutDataMapRequest putReq = PutDataMapRequest.create("/archery101010/watch_command");
                putReq.getDataMap().putString("command_json", enrichedPayload);
                putReq.getDataMap().putLong("sent_at", now);
                Wearable.getDataClient(this).putDataItem(putReq.asPutDataRequest().setUrgent());
            }
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
        if (wakeLock != null && !wakeLock.isHeld()) {
            try {
                wakeLock.acquire(4 * 60 * 60 * 1000L);
            } catch (Exception ignored) {}
        }
        ensureSensorAndHeartbeatActive();
        sendToPhone("{\"type\":\"REQUEST_STATE\"}");
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Do NOT unregister accelerometer or stop heartbeatRunnable here:
        // When the archer lowers their arm to draw/walk, Wear OS enters ambient mode (onPause).
        // Keeping sensors and sync active ensures zero missed shots or steps during the session.
        saveState();
    }

    @Override
    protected void onDestroy() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable);
        if (sensorManager != null && isSensorRegistered) {
            try {
                sensorManager.unregisterListener(this);
                isSensorRegistered = false;
            } catch (Exception ignored) {}
        }
        if (messageListener != null) {
            try {
                Wearable.getMessageClient(this).removeListener(messageListener);
                messageListener = null;
            } catch (Exception ignored) {}
        }
        if (dataListener != null) {
            try {
                Wearable.getDataClient(this).removeListener(dataListener);
                dataListener = null;
            } catch (Exception ignored) {}
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
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
        editor.putLong("cmdSequence", cmdSequence);
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
                lastLocalActionTimeMs = now;
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
            if (wakeLock != null && !wakeLock.isHeld()) {
                try {
                    wakeLock.acquire(4 * 60 * 60 * 1000L);
                } catch (Exception ignored) {}
            }
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
                    lastLocalActionTimeMs = System.currentTimeMillis();
                    autoDetectEnabled = !autoDetectEnabled;
                    triggerHaptic(25);
                    sendToPhone("{\"type\":\"TOGGLE_AUTO_DETECT\",\"enabled\":" + autoDetectEnabled + "}");
                    invalidate();
                    return;
                }
                if (btnLeftPrimary.contains(x, y)) {
                    lastLocalActionTimeMs = System.currentTimeMillis();
                    arrowCount++;
                    triggerHaptic(45);
                    saveState();
                    sendToPhone("{\"type\":\"INCREMENT_ARROW\",\"delta\":1,\"source\":\"watch_manual\"}");
                    invalidate();
                    return;
                }
                if (btnRightSecondary.contains(x, y)) {
                    if (arrowCount > 0) {
                        lastLocalActionTimeMs = System.currentTimeMillis();
                        arrowCount--;
                        if (!currentEndArrows.isEmpty()) {
                            String removed = currentEndArrows.remove(currentEndArrows.size() - 1);
                            int pts = "X".equals(removed) || "10".equals(removed) ? 10 : ("M".equals(removed) ? 0 : Integer.parseInt(removed));
                            totalScore = Math.max(0, totalScore - pts);
                            totalScoredArrows = Math.max(0, totalScoredArrows - 1);
                        }
                        triggerHaptic(25);
                        saveState();
                        sendToPhone("{\"type\":\"DECREMENT_ARROW\",\"delta\":-1,\"source\":\"watch_manual\",\"totalScore\":" + totalScore + "}");
                        invalidate();
                    }
                    return;
                }
            } else if (screenIndex == 1) {
                for (int i = 0; i < 6; i++) {
                    if (scoreButtons[i].contains(x, y)) {
                        lastLocalActionTimeMs = System.currentTimeMillis();
                        if (currentEndArrows.size() >= syncedArrowsPerEnd) {
                            if (currentEnd < syncedEndsCount) {
                                currentEndArrows.clear();
                                currentEnd++;
                            } else {
                                return;
                            }
                        }
                        String val = scoreLabels[i];
                        currentEndArrows.add(val);
                        int pts = "X".equals(val) || "10".equals(val) ? 10 : ("M".equals(val) ? 0 : Integer.parseInt(val));
                        totalScore += pts;
                        totalScoredArrows++;
                        arrowCount = Math.max(arrowCount + 1, totalScoredArrows);
                        triggerHaptic(35);
                        saveState();
                        sendToPhone("{\"type\":\"SCORE_INPUT\",\"payload\":{\"value\":\"" + val + "\",\"totalScore\":" + totalScore + "}}");
                        invalidate();
                        return;
                    }
                }
                if (btnLeftPrimary.contains(x, y)) {
                    if (!currentEndArrows.isEmpty()) {
                        lastLocalActionTimeMs = System.currentTimeMillis();
                        String removed = currentEndArrows.remove(currentEndArrows.size() - 1);
                        int pts = "X".equals(removed) || "10".equals(removed) ? 10 : ("M".equals(removed) ? 0 : Integer.parseInt(removed));
                        totalScore = Math.max(0, totalScore - pts);
                        totalScoredArrows = Math.max(0, totalScoredArrows - 1);
                        arrowCount = Math.max(0, arrowCount - 1);
                        triggerHaptic(25);
                        saveState();
                        sendToPhone("{\"type\":\"UNDO_ARROW\",\"totalScore\":" + totalScore + "}");
                        invalidate();
                    }
                    return;
                }
                if (btnRightSecondary.contains(x, y)) {
                    if (!currentEndArrows.isEmpty()) {
                        lastLocalActionTimeMs = System.currentTimeMillis();
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
                    sendToPhone("/archery101010/ping", "{\"type\":\"PING\"}", false);
                    sendToPhone("{\"type\":\"REQUEST_STATE\"}");
                    invalidate();
                    return;
                }
            } else if (screenIndex == 3) {
                if (btnLeftPrimary.contains(x, y)) {
                    // Finish session on phone first, then reset local watch counters with cooldown guard
                    triggerHaptic(70);
                    lastFinishedTimestampMs = System.currentTimeMillis();
                    lastFinishedSessionId = currentSessionId;
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

        private void drawCenteredText(Canvas canvas, String text, float cx, float cy) {
            Paint.FontMetrics fm = paint.getFontMetrics();
            float baseline = cy - (fm.ascent + fm.descent) / 2f;
            canvas.drawText(text, cx, baseline, paint);
        }

        private void drawTricolorHeader(Canvas canvas, float cx, float topY, float scale) {
            paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            paint.setTextSize(13.5f * scale);

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
            float barW = 96f * scale;
            float barH = 2f * scale;
            float barX = cx - barW / 2f;
            float barY = topY + 4.5f * scale;
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

            // Tricolor Header: ARCHERY 101010 (positioned within circular top safe zone)
            drawTricolorHeader(canvas, cx, 29f * scale, scale);

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
            float dotY = h - 13f * scale;
            float dotSpacing = 11f * scale;
            float startDotX = cx - (1.5f * dotSpacing);
            for (int i = 0; i < 4; i++) {
                if (i == screenIndex) {
                    paint.setColor(Color.parseColor("#00A8F3"));
                    canvas.drawCircle(startDotX + i * dotSpacing, dotY, 3.2f * scale, paint);
                } else {
                    paint.setColor(Color.parseColor("#44444F"));
                    canvas.drawCircle(startDotX + i * dotSpacing, dotY, 2.2f * scale, paint);
                }
            }
        }

        private void drawCounterScreen(Canvas canvas, int w, int h, float cx, float scale) {
            // Auto-Detector Pill (Circular Safe Zone)
            float pillW = 138f * scale;
            float pillH = 19f * scale;
            btnToggleDetector.set(cx - pillW / 2f, 41f * scale, cx + pillW / 2f, 41f * scale + pillH);
            paint.setColor(Color.parseColor("#0A0A0E"));
            canvas.drawRoundRect(btnToggleDetector, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(autoDetectEnabled ? Color.parseColor("#00A8F3") : Color.parseColor("#4A4A55"));
            canvas.drawRoundRect(btnToggleDetector, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setColor(Color.WHITE);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(8.8f * scale);
            drawCenteredText(
                    canvas,
                    autoDetectEnabled ? "● DETECTOR ACTIVO" : "○ DETECTOR PAUSADO",
                    cx,
                    btnToggleDetector.centerY()
            );

            // 4-Digit Mechanical Counter Housing
            String digits = String.format(Locale.US, "%04d", Math.min(9999, Math.max(0, arrowCount)));
            float slotW = 34f * scale;
            float slotH = 50f * scale;
            float gap = 4.5f * scale;
            float totalW = 4 * slotW + 3 * gap;
            float startX = cx - totalW / 2f;
            float topY = 67f * scale;

            for (int i = 0; i < 4; i++) {
                float sx = startX + i * (slotW + gap);
                rect.set(sx, topY, sx + slotW, topY + slotH);
                paint.setColor(Color.parseColor("#0A0A0D"));
                canvas.drawRoundRect(rect, 8f * scale, 8f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.4f * scale);
                paint.setColor(i == 3 ? Color.parseColor("#FFF200") : Color.parseColor("#2E2E38"));
                canvas.drawRoundRect(rect, 8f * scale, 8f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setColor(Color.WHITE);
                paint.setTextSize(31f * scale);
                paint.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
                drawCenteredText(canvas, String.valueOf(digits.charAt(i)), rect.centerX(), rect.centerY());
            }

            paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            paint.setTextSize(8.5f * scale);
            paint.setColor(Color.WHITE);
            String syncSubtitle = isPhoneConnected ? "● TELÉFONO SINCRONIZADO" : "CONTADOR AUTOMÁTICO";
            drawCenteredText(canvas, syncSubtitle, cx, 130f * scale);

            // Bottom Action Buttons: +1 FLECHA and DESHACER (148px total width = 33px bezel clearance per side)
            float btnW = 71f * scale;
            float btnH = 29f * scale;
            float btnY = 143f * scale;
            btnLeftPrimary.set(cx - btnW - 3f * scale, btnY, cx - 3f * scale, btnY + btnH);
            btnRightSecondary.set(cx + 3f * scale, btnY, cx + btnW + 3f * scale, btnY + btnH);

            paint.setColor(Color.parseColor("#0A1826"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            paint.setTextSize(9.5f * scale);
            drawCenteredText(canvas, "+1 FLECHA", btnLeftPrimary.centerX(), btnLeftPrimary.centerY());

            paint.setColor(Color.parseColor("#1A0808"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#FF0000"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "DESHACER", btnRightSecondary.centerX(), btnRightSecondary.centerY());
        }

        private void drawScorePadScreen(Canvas canvas, int w, int h, float cx, float scale) {
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(9f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(
                    canvas,
                    "RONDA " + currentEnd + "/" + syncedEndsCount + "  •  " + totalScore + " PTS",
                    cx,
                    47f * scale
            );

            // Dynamic Current Arrow Slots (syncedArrowsPerEnd, e.g., 3 or 6)
            int slotsCount = Math.max(1, Math.min(6, syncedArrowsPerEnd));
            float gap = (slotsCount <= 3 ? 5f : 3f) * scale;
            float totalSlotsW = 148f * scale;
            float slotW = (totalSlotsW - (slotsCount - 1) * gap) / slotsCount;
            float slotH = 24f * scale;
            float startX = cx - totalSlotsW / 2f;
            float slotY = 56f * scale;

            for (int i = 0; i < slotsCount; i++) {
                float sx = startX + i * (slotW + gap);
                rect.set(sx, slotY, sx + slotW, slotY + slotH);
                String val = i < currentEndArrows.size() ? currentEndArrows.get(i) : "—";
                paint.setColor(Color.parseColor("#0C0C10"));
                canvas.drawRoundRect(rect, 6f * scale, 6f * scale, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.2f * scale);
                paint.setColor(i == currentEndArrows.size() ? Color.parseColor("#00A8F3") : Color.parseColor("#2E2E38"));
                canvas.drawRoundRect(rect, 6f * scale, 6f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setColor(Color.WHITE);
                paint.setTextSize((slotsCount <= 3 ? 12.5f : 10.5f) * scale);
                drawCenteredText(canvas, val, rect.centerX(), rect.centerY());
            }

            // 6 Keypad Buttons (2 rows x 3 cols): X, 10, 9 / 8, 7, M
            float keyW = 46f * scale;
            float keyH = 26f * scale;
            float kGap = 5f * scale;
            float kStartX = cx - (3 * keyW + 2 * kGap) / 2f;
            float kStartY = 85f * scale;

            for (int i = 0; i < 6; i++) {
                int row = i / 3;
                int col = i % 3;
                float kx = kStartX + col * (keyW + kGap);
                float ky = kStartY + row * (keyH + kGap);
                scoreButtons[i].set(kx, ky, kx + keyW, ky + keyH);

                if (i < 3) {
                    paint.setColor(Color.parseColor("#191604"));
                } else if (i < 5) {
                    paint.setColor(Color.parseColor("#1D0606"));
                } else {
                    paint.setColor(Color.parseColor("#14141A"));
                }
                canvas.drawRoundRect(scoreButtons[i], 7f * scale, 7f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.3f * scale);
                if (i < 3) {
                    paint.setColor(Color.parseColor("#FFF200"));
                } else if (i < 5) {
                    paint.setColor(Color.parseColor("#FF0000"));
                } else {
                    paint.setColor(Color.parseColor("#4A4A58"));
                }
                canvas.drawRoundRect(scoreButtons[i], 7f * scale, 7f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setColor(Color.WHITE);
                paint.setTextSize(13f * scale);
                drawCenteredText(canvas, scoreLabels[i], scoreButtons[i].centerX(), scoreButtons[i].centerY());
            }

            // Bottom row: BORRAR and SIG. RONDA (148px total width within circular safe zone)
            float btnW = 71f * scale;
            float btnH = 25f * scale;
            float btnY = 148f * scale;
            btnLeftPrimary.set(cx - btnW - 3f * scale, btnY, cx - 3f * scale, btnY + btnH);
            btnRightSecondary.set(cx + 3f * scale, btnY, cx + btnW + 3f * scale, btnY + btnH);

            paint.setColor(Color.parseColor("#16161C"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(Color.parseColor("#3E3E4A"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            paint.setTextSize(8.8f * scale);
            drawCenteredText(canvas, "BORRAR", btnLeftPrimary.centerX(), btnLeftPrimary.centerY());

            paint.setColor(Color.parseColor("#0A1826"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "SIG. RONDA →", btnRightSecondary.centerX(), btnRightSecondary.centerY());
        }

        private void drawBiometricsScreen(Canvas canvas, int w, int h, float cx, float scale) {
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(9f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "TELEMETRÍA Y ENERGÍA", cx, 47f * scale);

            // Card 1: KCAL (152px width inside circular safe zone)
            float cardW = 152f * scale;
            float cardH = 41f * scale;
            rect.set(cx - cardW / 2f, 56f * scale, cx + cardW / 2f, 56f * scale + cardH);
            paint.setColor(Color.parseColor("#0B0B0F"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#FF0000"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTextSize(8.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "KCAL", cx, 66.5f * scale);
            paint.setTextSize(17.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, getActiveKcal() + " kcal", cx, 84.5f * scale);

            // Card 2: DISTANCIA RECORRIDA (0.00km/0.00mi)
            rect.set(cx - cardW / 2f, 102f * scale, cx + cardW / 2f, 102f * scale + cardH);
            paint.setColor(Color.parseColor("#0B0B0F"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTextSize(8.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "DISTANCIA RECORRIDA", cx, 112.5f * scale);
            paint.setTextSize(14.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, getFormattedKmAndMi(), cx, 130.5f * scale);

            // Live GPS + Steps telemetry sync pill
            float pillW = 144f * scale;
            float pillH = 24f * scale;
            btnLeftPrimary.set(cx - pillW / 2f, 149f * scale, cx + pillW / 2f, 149f * scale + pillH);
            paint.setColor(Color.parseColor("#0A1826"));
            canvas.drawRoundRect(btnLeftPrimary, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(8.3f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "GPS + PASOS EN VIVO • AUTO", cx, btnLeftPrimary.centerY());
        }

        private void drawSummaryScreen(Canvas canvas, int w, int h, float cx, float scale) {
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(9f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "RESUMEN DE SESIÓN", cx, 48f * scale);

            paint.setTextSize(26f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, totalScore + " PTS", cx, 76f * scale);

            paint.setTextSize(10.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, arrowCount + " FLECHAS  •  " + getActiveKcal() + " KCAL", cx, 102f * scale);

            paint.setTextSize(10.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, getFormattedKmAndMi(), cx, 121f * scale);

            float btnW = 144f * scale;
            float btnH = 30f * scale;
            btnLeftPrimary.set(cx - btnW / 2f, 142f * scale, cx + btnW / 2f, 142f * scale + btnH);
            paint.setColor(Color.parseColor("#0A1826"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.4f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTextSize(9.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "GUARDAR Y REINICIAR", cx, btnLeftPrimary.centerY());
        }
    }
}
