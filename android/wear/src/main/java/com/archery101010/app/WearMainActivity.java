package com.archery101010.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
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
import com.google.android.gms.wearable.Wearable;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Archery 101010 — Native Wear OS Watch App (Round & Square Smartwatches)
 * WHOOP / Apple / Nike Matte OLED Design DNA:
 *  - Official 4K Retina Brand Logo (ARCHERY in Good Times + Geometric 101010)
 *  - Bundled Outfit Athletic Tabular Typography (Zero coder slashed zeros, zero neon glow)
 *  - Mathematically Centered Vertical & Horizontal Layout for both Round and Square displays
 *  - 4 Screens:
 *      0: Contador y Auto-Tiro (VOLUMEN · FLECHAS + −1 / +1 / Live Km & Kcal)
 *      1: Puntuación de Tanda (X, 10, 9, 8, 7, M Keypad)
 *      2: Métricas (Distancia Km/Mi + Gasto Energético Kcal)
 *      3: Resumen y Envío a Coach
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
    private int distanceMeters = 18;
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
                wakeLock.acquire(4 * 60 * 60 * 1000L);
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

    private String getFormattedKm() {
        int mts = Math.max(0, Math.round(getEffectiveWalkedMeters()));
        return String.valueOf(mts);
    }

    private String getFormattedMi() {
        int ft = Math.max(0, Math.round(getEffectiveWalkedMeters() * 3.28084f));
        return String.valueOf(ft);
    }

    private String getFormattedKmAndMi() {
        return getFormattedKm() + " mts · " + getFormattedMi() + " ft";
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
            if (autoDetectEnabled && linearMag >= 13.5 && (now - lastShotTimestamp) > 2400L) {
                lastShotTimestamp = now;
                lastLocalActionTimeMs = now;
                arrowCount++;
                triggerHaptic(55);
                saveState();
                sendToPhone("{\"type\":\"INCREMENT_ARROW\",\"delta\":1,\"source\":\"watch_auto\"}");
                if (canvasView != null) canvasView.invalidate();
            } else if (dynamicLinear >= 1.15 && dynamicLinear <= 14.0 && (now - lastStepTimeMs) > 350L && (now - lastShotTimestamp) > 1200L) {
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
        private final Paint paint = new Paint(
                Paint.ANTI_ALIAS_FLAG |
                Paint.FILTER_BITMAP_FLAG |
                Paint.DITHER_FLAG |
                Paint.SUBPIXEL_TEXT_FLAG
        );
        private final RectF rect = new RectF();
        private final GestureDetector gestureDetector;

        // Bundled Outfit Athletic Typography (800 ExtraBold & 700 Bold)
        private Typeface outfitExtraBold;
        private Typeface outfitBold;

        // Official 4K Brand Logo Bitmaps (Progressive 2-step supersampled to exact physical pixel width)
        private Bitmap rawBrandLogo = null;
        private Bitmap scaledBrandLogo = null;
        private int cachedLogoWidthPx = 0;

        // Interactive hitboxes
        private final RectF btnLeftPrimary = new RectF();
        private final RectF btnRightSecondary = new RectF();
        private final RectF btnCenterMetrics = new RectF();
        private final RectF btnCounterChassis = new RectF();
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

            // Load bundled Outfit athletic font for razor-sharp tabular numbers without slashed zeros
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    outfitExtraBold = new Typeface.Builder(context.getAssets(), "fonts/Outfit.ttf")
                            .setFontVariationSettings("'wght' 800")
                            .build();
                    outfitBold = new Typeface.Builder(context.getAssets(), "fonts/Outfit.ttf")
                            .setFontVariationSettings("'wght' 700")
                            .build();
                }
            } catch (Exception ignored) {}
            if (outfitExtraBold == null) {
                try {
                    Typeface base = Typeface.createFromAsset(context.getAssets(), "fonts/Outfit.ttf");
                    outfitExtraBold = Typeface.create(base, Typeface.BOLD);
                    outfitBold = Typeface.create(base, Typeface.BOLD);
                } catch (Exception ignored) {
                    outfitExtraBold = Typeface.create("sans-serif", Typeface.BOLD);
                    outfitBold = Typeface.create("sans-serif-medium", Typeface.BOLD);
                }
            }

            // Load official 4K brand logo (1789x131) in unscaled ARGB_8888 quality
            try {
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inScaled = false;
                opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
                rawBrandLogo = BitmapFactory.decodeResource(context.getResources(), R.drawable.brand_logo_full, opts);
                if (rawBrandLogo == null) {
                    rawBrandLogo = BitmapFactory.decodeResource(context.getResources(), R.drawable.brand_logo_header, opts);
                }
            } catch (Exception ignored) {}

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

        private boolean isRoundDisplay(int w, int h) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    return getResources().getConfiguration().isScreenRound();
                } catch (Exception ignored) {}
            }
            return Math.abs(w - h) <= 6;
        }

        private void incrementArrowManually() {
            lastLocalActionTimeMs = System.currentTimeMillis();
            arrowCount++;
            triggerHaptic(45);
            saveState();
            sendToPhone("{\"type\":\"INCREMENT_ARROW\",\"delta\":1,\"source\":\"watch_manual\"}");
            invalidate();
        }

        private void decrementArrowManually() {
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
        }

        private void handleTap(float x, float y) {
            if (wakeLock != null && !wakeLock.isHeld()) {
                try {
                    wakeLock.acquire(4 * 60 * 60 * 1000L);
                } catch (Exception ignored) {}
            }
            int h = getHeight();

            // Bottom page indicator tap switches screen
            if (y > h * 0.87f) {
                screenIndex = (screenIndex + 1) % 4;
                triggerHaptic(20);
                invalidate();
                return;
            }

            // Status pill toggles auto-detector on Screen 0
            if (screenIndex == 0 && btnToggleDetector.contains(x, y)) {
                lastLocalActionTimeMs = System.currentTimeMillis();
                autoDetectEnabled = !autoDetectEnabled;
                triggerHaptic(25);
                sendToPhone("{\"type\":\"TOGGLE_AUTO_DETECT\",\"enabled\":" + autoDetectEnabled + "}");
                invalidate();
                return;
            }

            if (screenIndex == 0) {
                // +1 Button (Right) or tapping the 0000 counter chassis
                if (btnLeftPrimary.contains(x, y) || btnCounterChassis.contains(x, y)) {
                    incrementArrowManually();
                    return;
                }
                // -1 Button (Left)
                if (btnRightSecondary.contains(x, y)) {
                    decrementArrowManually();
                    return;
                }
                // Center Km/Kcal telemetry tap jumps to Metrics Screen (Screen 2)
                if (btnCenterMetrics.contains(x, y)) {
                    triggerHaptic(20);
                    screenIndex = 2;
                    invalidate();
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
            paint.setTextAlign(Paint.Align.CENTER);
            Paint.FontMetrics fm = paint.getFontMetrics();
            float baseline = cy - (fm.ascent + fm.descent) / 2f;
            canvas.drawText(text, cx, baseline, paint);
        }

        private Bitmap getSupersampledLogo(int targetWidthPx) {
            if (rawBrandLogo == null || targetWidthPx <= 0) return null;
            if (scaledBrandLogo != null && cachedLogoWidthPx == targetWidthPx) {
                return scaledBrandLogo;
            }
            try {
                float aspect = (float) rawBrandLogo.getWidth() / (float) Math.max(1, rawBrandLogo.getHeight());
                int targetHeightPx = Math.max(1, Math.round(targetWidthPx / aspect));
                // 2-step progressive supersampling from 1789px -> 2x target -> 1x target for zero aliasing
                int midW = Math.min(rawBrandLogo.getWidth(), targetWidthPx * 2);
                int midH = Math.max(1, Math.round(midW / aspect));
                Bitmap mid = Bitmap.createScaledBitmap(rawBrandLogo, midW, midH, true);
                scaledBrandLogo = Bitmap.createScaledBitmap(mid, targetWidthPx, targetHeightPx, true);
                if (mid != scaledBrandLogo && mid != rawBrandLogo) {
                    mid.recycle();
                }
                cachedLogoWidthPx = targetWidthPx;
            } catch (Exception ignored) {}
            return scaledBrandLogo;
        }

        /**
         * Draws the official 4K ARCHERY 101010 logo + Status Pill at the top of the centered stack.
         */
        private void drawBrandHeaderAndPill(
                Canvas canvas,
                float cx,
                float scale,
                boolean isRound,
                String pillText,
                boolean isYellowPill
        ) {
            int targetLogoW = Math.round((isRound ? 104f : 116f) * scale);
            Bitmap logo = getSupersampledLogo(targetLogoW);
            float logoTopY = 39f * scale;

            if (logo != null) {
                float leftX = Math.round(cx - logo.getWidth() / 2f);
                canvas.drawBitmap(logo, leftX, Math.round(logoTopY), paint);
            } else {
                paint.setTypeface(outfitExtraBold);
                paint.setTextSize(10.5f * scale);
                paint.setColor(Color.WHITE);
                drawCenteredText(canvas, "ARCHERY 101010", cx, logoTopY + 4f * scale);
            }

            // Status Pill below official logo
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(6.8f * scale);
            float textW = paint.measureText(pillText);
            float pillW = Math.max(114f * scale, textW + 24f * scale);
            float pillH = 16.5f * scale;
            float pillTopY = 52.5f * scale;

            btnToggleDetector.set(cx - pillW / 2f, pillTopY, cx + pillW / 2f, pillTopY + pillH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(isYellowPill ? Color.parseColor("#101006") : Color.parseColor("#040B12"));
            canvas.drawRoundRect(btnToggleDetector, pillH / 2f, pillH / 2f, paint);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(isYellowPill ? Color.parseColor("#73FFE500") : Color.parseColor("#6B00A8F3"));
            canvas.drawRoundRect(btnToggleDetector, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);

            // Dot + Text inside pill
            float dotR = 2.1f * scale;
            float contentW = (dotR * 2f) + (4.5f * scale) + textW;
            float startX = cx - contentW / 2f;
            paint.setColor(isYellowPill ? Color.parseColor("#FFE500") : Color.parseColor("#00A8F3"));
            canvas.drawCircle(startX + dotR, btnToggleDetector.centerY(), dotR, paint);

            paint.setColor(Color.WHITE);
            paint.setTextAlign(Paint.Align.LEFT);
            Paint.FontMetrics fm = paint.getFontMetrics();
            float baseline = btnToggleDetector.centerY() - (fm.ascent + fm.descent) / 2f;
            canvas.drawText(pillText, startX + (dotR * 2f) + (4.5f * scale), baseline, paint);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int w = getWidth();
            int h = getHeight();
            float cx = w / 2f;
            float cy = h / 2f;
            float scale = Math.min(w, h) / 240f;
            boolean isRound = isRoundDisplay(w, h);
            float wMult = isRound ? 1.0f : 1.10f;

            // Deep Matte OLED Background (#020305)
            canvas.drawColor(Color.parseColor("#020305"));

            // Crisp 1px inner safe bezel ring (Round or Square)
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#17FFFFFF"));
            if (isRound) {
                canvas.drawCircle(cx, cy, Math.min(w, h) / 2f - 2.5f * scale, paint);
            } else {
                rect.set(2.5f * scale, 2.5f * scale, w - 2.5f * scale, h - 2.5f * scale);
                canvas.drawRoundRect(rect, 36f * scale, 36f * scale, paint);
            }
            paint.setStyle(Paint.Style.FILL);

            if (screenIndex == 0) {
                drawCounterScreen(canvas, cx, scale, isRound, wMult);
            } else if (screenIndex == 1) {
                drawScorePadScreen(canvas, cx, scale, isRound, wMult);
            } else if (screenIndex == 2) {
                drawBiometricsScreen(canvas, cx, scale, isRound, wMult);
            } else {
                drawSummaryScreen(canvas, cx, scale, isRound, wMult);
            }

            // Bottom WHOOP-style Pill Pager Dots (y = 223f on virtual 240f grid)
            float dotY = h - 16.5f * scale;
            float dotGap = 4.5f * scale;
            float activeW = 11.5f * scale;
            float inactiveW = 3.6f * scale;
            float dotH = 3.6f * scale;
            float totalDotsW = activeW + 3f * inactiveW + 3f * dotGap;
            float curX = cx - totalDotsW / 2f;

            for (int i = 0; i < 4; i++) {
                float itemW = (i == screenIndex) ? activeW : inactiveW;
                rect.set(curX, dotY - dotH / 2f, curX + itemW, dotY + dotH / 2f);
                paint.setColor(i == screenIndex ? Color.parseColor("#00A8F3") : Color.parseColor("#38FFFFFF"));
                canvas.drawRoundRect(rect, dotH / 2f, dotH / 2f, paint);
                curX += itemW + dotGap;
            }
        }

        /**
         * SCREEN 0: CONTADOR Y AUTO-TIRO (Mathematically centered: 39f..188f around cy = 114f..120f)
         */
        private void drawCounterScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            String pillLabel = autoDetectEnabled
                    ? (isPhoneConnected ? "AUTO-TIRO · LIVE" : "AUTO-TIRO ACTIVO")
                    : "MODO MANUAL";
            drawBrandHeaderAndPill(canvas, cx, scale, isRound, pillLabel, false);

            // Outer Counter Chassis: VOLUMEN · FLECHAS (top = 77f, bottom = 152f, centerY = 114.5f)
            float chassisW = 168f * scale * wMult;
            float chassisH = 74f * scale;
            float chassisTop = 77f * scale;
            btnCounterChassis.set(cx - chassisW / 2f, chassisTop, cx + chassisW / 2f, chassisTop + chassisH);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(btnCounterChassis, 11.5f * scale, 11.5f * scale, paint);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#1AFFFFFF"));
            canvas.drawRoundRect(btnCounterChassis, 11.5f * scale, 11.5f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            // Label "VOLUMEN · FLECHAS"
            paint.setTypeface(outfitBold);
            paint.setTextSize(6.4f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            drawCenteredText(canvas, "VOLUMEN · FLECHAS", cx, chassisTop + 10.5f * scale);

            // Inner Dark Tray holding the 4 Digit Cells
            float trayPad = 7.5f * scale;
            float trayTop = chassisTop + 18f * scale;
            float trayBottom = chassisTop + chassisH - 7.5f * scale;
            rect.set(btnCounterChassis.left + trayPad, trayTop, btnCounterChassis.right - trayPad, trayBottom);
            paint.setColor(Color.parseColor("#030407"));
            canvas.drawRoundRect(rect, 8f * scale, 8f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(0.9f * scale);
            paint.setColor(Color.parseColor("#12FFFFFF"));
            canvas.drawRoundRect(rect, 8f * scale, 8f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            // 4 Digit Cells (0 0 0 0) in Outfit ExtraBold
            String digits = String.format(Locale.US, "%04d", Math.min(9999, Math.max(0, arrowCount)));
            float innerPad = 4f * scale;
            float cellGap = 4.2f * scale;
            float availW = rect.width() - (2f * innerPad) - (3f * cellGap);
            float cellW = availW / 4f;
            float cellH = rect.height() - (2f * innerPad);
            float cellTop = rect.top + innerPad;
            float startCellX = rect.left + innerPad;

            for (int i = 0; i < 4; i++) {
                float sx = startCellX + i * (cellW + cellGap);
                rect.set(sx, cellTop, sx + cellW, cellTop + cellH);
                boolean isUnits = (i == 3);

                paint.setStyle(Paint.Style.FILL);
                paint.setColor(isUnits ? Color.parseColor("#101008") : Color.parseColor("#0B0E15"));
                canvas.drawRoundRect(rect, 5.5f * scale, 5.5f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.0f * scale);
                paint.setColor(isUnits ? Color.parseColor("#FFE500") : Color.parseColor("#1EFFFFFF"));
                canvas.drawRoundRect(rect, 5.5f * scale, 5.5f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setTypeface(outfitExtraBold);
                paint.setTextSize(21f * scale);
                paint.setColor(isUnits ? Color.parseColor("#FFE500") : Color.WHITE);
                drawCenteredText(canvas, String.valueOf(digits.charAt(i)), rect.centerX(), rect.centerY());
            }

            // Bottom Symmetrical Row: [-1]  |  0.04 km · 2 kcal / TANDA 1 · 18 M  |  [+1]
            float rowW = 160f * scale * wMult;
            float btnW = 30f * scale;
            float btnH = 22.5f * scale;
            float btnTop = 163f * scale;

            // Left Button: −1 (stored in btnRightSecondary)
            btnRightSecondary.set(cx - rowW / 2f, btnTop, cx - rowW / 2f + btnW, btnTop + btnH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#180709"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#A6FF1E1E"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(9.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "−1", btnRightSecondary.centerX(), btnRightSecondary.centerY());

            // Center Telemetry (15 mts · 2 kcal / TANDA 1 · 18 M)
            btnCenterMetrics.set(btnRightSecondary.right + 4f * scale, btnTop - 2f * scale, cx + rowW / 2f - btnW - 4f * scale, btnTop + btnH + 2f * scale);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(8.8f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, getFormattedKm() + " mts · " + getActiveKcal() + " kcal", cx, btnTop + 7f * scale);

            paint.setTypeface(outfitBold);
            paint.setTextSize(6.6f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            int displayTanda = Math.max(1, currentEnd);
            drawCenteredText(canvas, "TANDA " + displayTanda + " · " + distanceMeters + " M", cx, btnTop + 17.5f * scale);

            // Right Button: +1 (stored in btnLeftPrimary)
            btnLeftPrimary.set(cx + rowW / 2f - btnW, btnTop, cx + rowW / 2f, btnTop + btnH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#061523"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(9.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "+1", btnLeftPrimary.centerX(), btnLeftPrimary.centerY());
        }

        /**
         * SCREEN 1: PUNTUACIÓN DE TANDA (Mathematically centered: 39f..188f)
         */
        private void drawScorePadScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            drawBrandHeaderAndPill(
                    canvas,
                    cx,
                    scale,
                    isRound,
                    "TANDA " + currentEnd + "/" + syncedEndsCount + " · " + totalScore + " PTS",
                    false
            );

            // Dynamic Current Arrow Slots (3 or 6 slots)
            int slotsCount = Math.max(1, Math.min(6, syncedArrowsPerEnd));
            float gap = (slotsCount <= 3 ? 4.5f : 3.2f) * scale;
            float totalSlotsW = 162f * scale * wMult;
            float slotW = (totalSlotsW - (slotsCount - 1) * gap) / slotsCount;
            float slotH = 19.5f * scale;
            float startX = cx - totalSlotsW / 2f;
            float slotY = 75f * scale;

            for (int i = 0; i < slotsCount; i++) {
                float sx = startX + i * (slotW + gap);
                rect.set(sx, slotY, sx + slotW, slotY + slotH);
                String val = i < currentEndArrows.size() ? currentEndArrows.get(i) : "—";
                boolean isCurrentSlot = (i == currentEndArrows.size());

                paint.setStyle(Paint.Style.FILL);
                paint.setColor(isCurrentSlot ? Color.parseColor("#061320") : Color.parseColor("#07090E"));
                canvas.drawRoundRect(rect, 4.5f * scale, 4.5f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.0f * scale);
                paint.setColor(isCurrentSlot ? Color.parseColor("#00A8F3") : Color.parseColor("#1FFFFFFF"));
                canvas.drawRoundRect(rect, 4.5f * scale, 4.5f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setTypeface(outfitExtraBold);
                paint.setTextSize((slotsCount <= 3 ? 10.5f : 8.8f) * scale);
                paint.setColor(Color.WHITE);
                drawCenteredText(canvas, val, rect.centerX(), rect.centerY());
            }

            // 6 Keypad Buttons (2 rows x 3 cols): X, 10, 9 / 8, 7, M
            float keypadW = 162f * scale * wMult;
            float kGap = 4.5f * scale;
            float keyW = (keypadW - 2f * kGap) / 3f;
            float keyH = 24f * scale;
            float kStartX = cx - keypadW / 2f;
            float kStartY = 101f * scale;

            for (int i = 0; i < 6; i++) {
                int row = i / 3;
                int col = i % 3;
                float kx = kStartX + col * (keyW + kGap);
                float ky = kStartY + row * (keyH + kGap);
                scoreButtons[i].set(kx, ky, kx + keyW, ky + keyH);

                paint.setStyle(Paint.Style.FILL);
                if (i < 3) {
                    paint.setColor(Color.parseColor("#111007"));
                } else if (i < 5) {
                    paint.setColor(Color.parseColor("#160708"));
                } else {
                    paint.setColor(Color.parseColor("#0B0E14"));
                }
                canvas.drawRoundRect(scoreButtons[i], 6f * scale, 6f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.0f * scale);
                if (i < 3) {
                    paint.setColor(Color.parseColor("#99FFE500"));
                } else if (i < 5) {
                    paint.setColor(Color.parseColor("#99FF1E1E"));
                } else {
                    paint.setColor(Color.parseColor("#26FFFFFF"));
                }
                canvas.drawRoundRect(scoreButtons[i], 6f * scale, 6f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setTypeface(outfitExtraBold);
                paint.setTextSize(10.5f * scale);
                if (i < 3) {
                    paint.setColor(Color.parseColor("#FFE500"));
                } else if (i < 5) {
                    paint.setColor(Color.WHITE);
                } else {
                    paint.setColor(Color.parseColor("#8E96A4"));
                }
                drawCenteredText(canvas, scoreLabels[i], scoreButtons[i].centerX(), scoreButtons[i].centerY());
            }

            // Bottom row: BORRAR and SIG. TANDA →
            float pairW = 154f * scale * wMult;
            float btnW = (pairW - 5f * scale) / 2f;
            float btnH = 21.5f * scale;
            float btnY = 161.5f * scale;
            btnLeftPrimary.set(cx - pairW / 2f, btnY, cx - pairW / 2f + btnW, btnY + btnH);
            btnRightSecondary.set(cx + pairW / 2f - btnW, btnY, cx + pairW / 2f, btnY + btnH);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#0B0E14"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#24FFFFFF"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(7.2f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            drawCenteredText(canvas, "BORRAR", btnLeftPrimary.centerX(), btnLeftPrimary.centerY());

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#061523"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "SIG. TANDA →", btnRightSecondary.centerX(), btnRightSecondary.centerY());
        }

        /**
         * SCREEN 2: MÉTRICAS (KM / KCAL) (Mathematically centered: 39f..188f)
         */
        private void drawBiometricsScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            drawBrandHeaderAndPill(canvas, cx, scale, isRound, "GPS ACTIVO · PASOS", true);

            float cardW = 166f * scale * wMult;
            float cardH = 38.5f * scale;

            // Card 1: DISTANCIA RECORRIDA (km · mi + GPS badge)
            float card1Top = 77f * scale;
            rect.set(cx - cardW / 2f, card1Top, cx + cardW / 2f, card1Top + cardH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(rect, 9.5f * scale, 9.5f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#7300A8F3"));
            canvas.drawRoundRect(rect, 9.5f * scale, 9.5f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitBold);
            paint.setTextSize(6.2f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText("DISTANCIA RECORRIDA", rect.left + 9.5f * scale, card1Top + 13.5f * scale, paint);

            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(12.2f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText(getFormattedKmAndMi(), rect.left + 9.5f * scale, card1Top + 29.5f * scale, paint);

            // GPS Badge inside Card 1
            float badgeW = 28f * scale;
            float badgeH = 14.5f * scale;
            RectF badgeRect = new RectF(rect.right - badgeW - 8.5f * scale, rect.centerY() - badgeH / 2f, rect.right - 8.5f * scale, rect.centerY() + badgeH / 2f);
            paint.setColor(Color.parseColor("#04101C"));
            canvas.drawRoundRect(badgeRect, 4f * scale, 4f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(0.9f * scale);
            paint.setColor(Color.parseColor("#8000A8F3"));
            canvas.drawRoundRect(badgeRect, 4f * scale, 4f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(6.2f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "GPS", badgeRect.centerX(), badgeRect.centerY());

            // Card 2: GASTO ENERGÉTICO (kcal + ACTIVA badge)
            float card2Top = 121.5f * scale;
            rect.set(cx - cardW / 2f, card2Top, cx + cardW / 2f, card2Top + cardH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(rect, 9.5f * scale, 9.5f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#73FF1E1E"));
            canvas.drawRoundRect(rect, 9.5f * scale, 9.5f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitBold);
            paint.setTextSize(6.2f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText("GASTO ENERGÉTICO", rect.left + 9.5f * scale, card2Top + 13.5f * scale, paint);

            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(13f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText(getActiveKcal() + " kcal", rect.left + 9.5f * scale, card2Top + 29.5f * scale, paint);

            // ACTIVA Badge inside Card 2
            float badge2W = 36f * scale;
            badgeRect.set(rect.right - badge2W - 8.5f * scale, rect.centerY() - badgeH / 2f, rect.right - 8.5f * scale, rect.centerY() + badgeH / 2f);
            paint.setColor(Color.parseColor("#101008"));
            canvas.drawRoundRect(badgeRect, 4f * scale, 4f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(0.9f * scale);
            paint.setColor(Color.parseColor("#80FFE500"));
            canvas.drawRoundRect(badgeRect, 4f * scale, 4f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(6.2f * scale);
            paint.setColor(Color.parseColor("#FFE500"));
            drawCenteredText(canvas, "ACTIVA", badgeRect.centerX(), badgeRect.centerY());

            // Bottom Sync Subtitle (tap triggers immediate telemetry sync)
            btnLeftPrimary.set(cx - 75f * scale, 166f * scale, cx + 75f * scale, 190f * scale);
            paint.setTypeface(outfitBold);
            paint.setTextSize(6.6f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            drawCenteredText(
                    canvas,
                    arrowCount + " FLECHAS · " + Math.round(drawWeightLbs) + " LBS · SYNC EN VIVO",
                    cx,
                    175f * scale
            );
        }

        /**
         * SCREEN 3: RESUMEN Y ENVÍO A COACH (Mathematically centered: 39f..188f)
         */
        private void drawSummaryScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            drawBrandHeaderAndPill(canvas, cx, scale, isRound, "SINCRONIZADO CON COACH", false);

            float gridW = 166f * scale * wMult;
            float colGap = 5f * scale;
            float colW = (gridW - colGap) / 2f;
            float row1Top = 76f * scale;
            float row1H = 36f * scale;

            // Box 1: FLECHAS
            rect.set(cx - gridW / 2f, row1Top, cx - gridW / 2f + colW, row1Top + row1H);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(rect, 8.5f * scale, 8.5f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#7300A8F3"));
            canvas.drawRoundRect(rect, 8.5f * scale, 8.5f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitBold);
            paint.setTextSize(6.0f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            drawCenteredText(canvas, "FLECHAS", rect.centerX(), row1Top + 10.5f * scale);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(12.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, arrowCount + " FL", rect.centerX(), row1Top + 25f * scale);

            // Box 2: ENERGÍA
            rect.set(cx + gridW / 2f - colW, row1Top, cx + gridW / 2f, row1Top + row1H);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(rect, 8.5f * scale, 8.5f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#73FF1E1E"));
            canvas.drawRoundRect(rect, 8.5f * scale, 8.5f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitBold);
            paint.setTextSize(6.0f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            drawCenteredText(canvas, "ENERGÍA", rect.centerX(), row1Top + 10.5f * scale);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(12.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, getActiveKcal() + " kcal", rect.centerX(), row1Top + 25f * scale);

            // Box 3 (Full width): DISTANCIA TOTAL
            float row2Top = 117f * scale;
            float row2H = 34f * scale;
            rect.set(cx - gridW / 2f, row2Top, cx + gridW / 2f, row2Top + row2H);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(rect, 8.5f * scale, 8.5f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#73FFE500"));
            canvas.drawRoundRect(rect, 8.5f * scale, 8.5f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitBold);
            paint.setTextSize(6.0f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            drawCenteredText(canvas, "DISTANCIA TOTAL", cx, row2Top + 10f * scale);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(11.2f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, getFormattedKmAndMi(), cx, row2Top + 23.5f * scale);

            // Bottom Action Button: ENVIAR SESIÓN A COACH
            float btnW = 152f * scale * wMult;
            float btnH = 22.5f * scale;
            float btnTop = 160f * scale;
            btnLeftPrimary.set(cx - btnW / 2f, btnTop, cx + btnW / 2f, btnTop + btnH);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#061523"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(7.2f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "ENVIAR SESIÓN A COACH", btnLeftPrimary.centerX(), btnLeftPrimary.centerY());
        }
    }
}
