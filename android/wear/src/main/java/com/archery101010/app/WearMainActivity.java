package com.archery101010.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.GestureDetector;
import android.view.KeyEvent;
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
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Archery 101010 — Native Wear OS Watch App (Round & Square Smartwatches)
 * Matte OLED Design DNA:
 *  - Official 4K Retina Brand Logo (ARCHERY in Good Times + Geometric 101010)
 *  - Bundled Outfit Athletic Tabular Typography (Zero coder slashed zeros, zero neon glow)
 *  - Bilingual ES/EN + Metric/Imperial Regional Units
 *  - 5 Screens:
 *      0: Counter & Auto-Shot (ARROWS + -1 / +1 / Walked Distance & Kcal)
 *      1: XL 4x3 Scorepad (X, 10..1, M + DEL / NEXT END)
 *      2: Biometrics (Walked Distance m/km or ft/mi + Steps + Active Energy Kcal)
 *      3: Session Summary & Save Session
 *      4: 6-Digit Cloud Code Pairing
 */
public class WearMainActivity extends Activity implements SensorEventListener {
    private static volatile WeakReference<WearMainActivity> activeInstanceRef = new WeakReference<>(null);

    public static WearMainActivity getActiveInstance() {
        return activeInstanceRef != null ? activeInstanceRef.get() : null;
    }

    public void onBackgroundPhoneEvent(final String path, final String payload, final String sourceNodeId) {
        long now = System.currentTimeMillis();
        isPhoneConnected = true;
        lastPhoneSyncMs = now;
        if ("/archery101010/ping".equals(path)) {
            byte[] pongBytes = ("{\"type\":\"PONG\",\"_ts\":" + now + "}").getBytes(StandardCharsets.UTF_8);
            if (sourceNodeId != null && !sourceNodeId.isEmpty()) {
                Wearable.getMessageClient(this).sendMessage(sourceNodeId, "/archery101010/pong", pongBytes);
            }
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
        if ("/archery101010/hr_request".equals(path)) {
            runOnUiThread(() -> startHeartRateStreaming(true, true));
            return;
        }
        if (payload != null && !payload.isEmpty()) {
            handleIncomingPhonePayload(payload);
        }
    }

    private static final String PREFS_NAME = "archery_101010_wear_prefs";
    private static final int REQ_MIC_AUTO_SHOT = 1010;
    private static final int SENSOR_RATE_100HZ_US = 10_000; // 100 Hz (10,000 us) — no HIGH_SAMPLING_RATE permission needed
    private static final int AUDIO_SAMPLE_RATE_HZ = 16_000;
    private static final int AUDIO_FRAME_SAMPLES = 160; // 10 ms real-time transient frame

    private SensorManager sensorManager;
    private Sensor accelerometer;
    private Sensor gyroscope;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private boolean isSensorRegistered = false;
    private boolean isSensorHighRateMode = false;
    private volatile long lastWatchTapMs = 0L;
    private double stepGravityMag = SensorManager.GRAVITY_EARTH;
    private double stepSmoothLin = 0.0;
    private boolean stepArmedForPeak = true;
    private boolean stepPeakSeen = false;
    private double stepLastMeanIv = 580.0;

    // Dual-Key Real-Time Acoustic String-Snap DSP state (100% on-device volatile memory, never recorded/saved)
    private volatile boolean isAcousticAnalyzerRunning = false;
    private Thread acousticAnalyzerThread = null;
    private volatile long lastVerifiedAcousticSnapMs = 0L;
    private volatile long micDeniedNoticeUntilMs = 0L;

    private int screenIndex = 0; // 0..4
    private int arrowCount = 0;
    private boolean autoDetectEnabled = false;
    // Sensitivity level: 0 = BAJA (less sensitive), 1 = MEDIA (default), 2 = ALTA (more sensitive)
    private int sensitivityLevel = 1;
    private long lastShotTimestamp = 0L;
    private long lastStepTimeMs = 0L;
    private long prevStepTimeMs = 0L;
    private int recentStepBoutCount = 0;
    private long walkingLockUntilMs = 0L;
    private long lastTelemetrySyncTimeMs = 0L;
    private double smoothedAccelMag = SensorManager.GRAVITY_EARTH;

    // Latest hardware gyroscope angular rate (rad/s) time-aligned into the 3D motion buffer
    private float latestGyroRadS = -1f;
    private float latestGyroY = 0f;
    private float latestGyroZ = 0f;
    private long lastGyroSampleMs = 0L;

    // 7-Gate 3D Biomechanical Ring Buffer (~30.7s at 100 Hz for full INICIO -> FINAL shots)
    private static final int MOTION_BUF = 3072;
    private final long[] motionT = new long[MOTION_BUF];
    private final float[] motionAx = new float[MOTION_BUF];
    private final float[] motionAy = new float[MOTION_BUF];
    private final float[] motionAz = new float[MOTION_BUF];
    private final float[] motionGy = new float[MOTION_BUF];
    private final float[] motionGz = new float[MOTION_BUF];
    private final double[] motionMag = new double[MOTION_BUF];
    private final double[] motionLin = new double[MOTION_BUF];
    private final float[] motionGyro = new float[MOTION_BUF];
    private int motionIdx = 0;
    private int motionCount = 0;

    // Biomechanical Analysis mode state (2-Screen Diana + Shot Metrics + Manual INICIO/FINAL)
    private boolean analysisMode = false;
    private boolean analysisAutoMode = false;
    private volatile boolean manualAnalysisRecording = false;
    private volatile long manualAnalysisStartMs = 0L;
    private long lastHandledManualStartAt = 0L;
    private long lastHandledManualStopAt = 0L;
    private long lastPhysicalButtonToggleMs = 0L;
    private int analysisPage = 0; // 0 = Diana, 1 = Datos
    private String syncedBowType = "Barebow";
    private String syncedBowWrist = "LEFT";
    private int syncedHeartRateBpm = 0;

    // ── Live wrist pulse streaming to the phone (/archery101010/hr + 6-Digit Cloud Firestore) ──
    private static final int REQ_HEART_RATE = 1011;
    private static final String PERM_READ_HEART_RATE = "android.permission.health.READ_HEART_RATE";
    private static final long HR_SEND_INTERVAL_MS = 1000L;
    private static final long HR_KEEPALIVE_INTERVAL_MS = 2500L;
    private static final long HR_DATA_ITEM_INTERVAL_MS = 3500L;
    private static final long HR_CLOUD_PUSH_INTERVAL_MS = 5000L;
    // Sensor.TYPE_HEART_RATE uses REPORTING_MODE_ON_CHANGE (fires only when BPM integer changes).
    // Keep reading valid while registered on skin, and re-query hardware every 45s of steady pulse.
    private static final long LOCAL_HR_FRESH_MS = 120_000L;
    private static final long HR_STEADY_REQUERY_MS = 45_000L;
    private Sensor heartRateSensor;
    private boolean isHrSensorRegistered = false;
    private boolean hrPermissionRequestedThisRun = false;
    private boolean hrPermissionPromptInFlight = false;
    private int hrPermissionDeniedCount = 0;
    private volatile String hrStatusCode = "idle"; // idle | permission_denied | no_sensor | reading | no_contact | ok
    private volatile int localSensorHrBpm = 0;
    private volatile long localSensorHrAtMs = 0L;
    private volatile long localHrSumBpm = 0L;
    private volatile int localHrSampleCount = 0;
    private volatile int localAvgHrBpm = 0;
    private volatile int localMaxHrBpm = 0;
    private long lastHrSentMs = 0L;
    private long lastHrDataItemSentMs = 0L;
    private int lastHrDataItemSentBpm = -1;
    private String lastHrDataItemSentStatus = "";
    private long lastHrSampleAccumMs = 0L;
    private long lastHrStatusSentMs = 0L;
    private long lastCloudHrPushMs = 0L;
    private int lastCloudHrPushedBpm = 0;
    private String cachedWatchDisplayName = null;

    private final Runnable hrKeepaliveRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isHrSensorRegistered) return;
            long now = System.currentTimeMillis();
            if (isLocalHeartRateFresh()) {
                if ((now - localSensorHrAtMs) >= HR_STEADY_REQUERY_MS && sensorManager != null && heartRateSensor != null) {
                    // Re-trigger REPORTING_MODE_ON_CHANGE hardware event so steady pulse stays hardware-verified
                    try {
                        sensorManager.unregisterListener(heartRateListener);
                        sensorManager.registerListener(heartRateListener, heartRateSensor, SensorManager.SENSOR_DELAY_NORMAL);
                        localSensorHrAtMs = now;
                    } catch (Exception ignored) {}
                }
                int bpm = localSensorHrBpm;
                if (bpm >= 30 && bpm <= 245) {
                    if ((now - lastHrSampleAccumMs) >= 2400L) {
                        lastHrSampleAccumMs = now;
                        localHrSumBpm += bpm;
                        localHrSampleCount += 1;
                        localAvgHrBpm = (int) Math.round((double) localHrSumBpm / Math.max(1, localHrSampleCount));
                        if (bpm > localMaxHrBpm) {
                            localMaxHrBpm = bpm;
                        }
                    }
                    if ((now - lastHrSentMs) >= 2000L) {
                        lastHrSentMs = now;
                        sendHeartRateToPhone(bpm, "ok");
                    }
                    boolean activeForCloudHr = analysisMode
                            || manualAnalysisRecording
                            || !currentSessionId.isEmpty()
                            || (now - lastActivityMs) < 600_000L;
                    if (hasPairingCode && pairingCode.length() == 6 && !isEditingCode && activeForCloudHr
                            && (bpm != lastCloudHrPushedBpm || (now - lastCloudHrPushMs) >= HR_CLOUD_PUSH_INTERVAL_MS)) {
                        lastCloudHrPushMs = now;
                        lastCloudHrPushedBpm = bpm;
                        lastCloudHeartbeatTouchMs = now;
                        touchWatchHeartbeatInFirestore(pairingCode, now);
                    }
                }
            } else if ("reading".equals(hrStatusCode) && (now - lastHrStatusSentMs) >= 4000L) {
                lastHrStatusSentMs = now;
                sendHeartRateToPhone(0, "reading");
            }
            heartbeatHandler.postDelayed(this, HR_KEEPALIVE_INTERVAL_MS);
        }
    };

    private final SensorEventListener heartRateListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event == null || event.values == null || event.values.length == 0) return;
            long now = System.currentTimeMillis();
            if (event.accuracy == SensorManager.SENSOR_STATUS_NO_CONTACT) {
                localSensorHrBpm = 0;
                hrStatusCode = "no_contact";
                if (now - lastHrStatusSentMs >= 3000L) {
                    lastHrStatusSentMs = now;
                    sendHeartRateToPhone(0, "no_contact");
                    runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
                }
                return;
            }
            int bpm = Math.round(event.values[0]);
            if (bpm < 30 || bpm > 245) return;
            boolean isFirstReading = (localSensorHrBpm < 30);
            boolean bpmChanged = (bpm != localSensorHrBpm);
            localSensorHrBpm = bpm;
            localSensorHrAtMs = now;
            syncedHeartRateBpm = bpm;
            hrStatusCode = "ok";
            lastHrSampleAccumMs = now;
            localHrSumBpm += bpm;
            localHrSampleCount += 1;
            localAvgHrBpm = (int) Math.round((double) localHrSumBpm / Math.max(1, localHrSampleCount));
            if (bpm > localMaxHrBpm) {
                localMaxHrBpm = bpm;
            }
            if (isFirstReading || bpmChanged || (now - lastHrSentMs) >= HR_SEND_INTERVAL_MS) {
                lastHrSentMs = now;
                sendHeartRateToPhone(bpm, "ok");
                runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
            }
            if (hasPairingCode && pairingCode.length() == 6 && !isEditingCode
                    && (isFirstReading || (now - lastCloudHrPushMs) >= HR_CLOUD_PUSH_INTERVAL_MS)) {
                lastCloudHrPushMs = now;
                lastCloudHrPushedBpm = bpm;
                lastCloudHeartbeatTouchMs = now;
                touchWatchHeartbeatInFirestore(pairingCode, now);
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
            if (accuracy == SensorManager.SENSOR_STATUS_NO_CONTACT) {
                long now = System.currentTimeMillis();
                localSensorHrBpm = 0;
                hrStatusCode = "no_contact";
                if (now - lastHrStatusSentMs >= 3000L) {
                    lastHrStatusSentMs = now;
                    sendHeartRateToPhone(0, "no_contact");
                    runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
                }
            }
        }
    };

    private boolean isLocalHeartRateFresh() {
        return isHrSensorRegistered
                && !"no_contact".equals(hrStatusCode)
                && localSensorHrBpm >= 30
                && localSensorHrBpm <= 245
                && (System.currentTimeMillis() - localSensorHrAtMs) < LOCAL_HR_FRESH_MS;
    }

    private String getRequiredHeartRatePermission() {
        return Build.VERSION.SDK_INT >= 36 ? PERM_READ_HEART_RATE : Manifest.permission.BODY_SENSORS;
    }

    private boolean hasHeartRatePermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return checkSelfPermission(getRequiredHeartRatePermission()) == PackageManager.PERMISSION_GRANTED;
    }

    private String getWatchDisplayName() {
        if (cachedWatchDisplayName != null) return cachedWatchDisplayName;
        String name = null;
        try {
            name = android.provider.Settings.Global.getString(getContentResolver(), "device_name");
        } catch (Exception ignored) {}
        if (name == null || name.trim().isEmpty()) {
            name = Build.MODEL;
        }
        cachedWatchDisplayName = name != null ? name.trim() : "";
        return cachedWatchDisplayName;
    }

    private void sendHeartRateToPhone(int bpm, String status) {
        try {
            long now = System.currentTimeMillis();
            JSONObject obj = new JSONObject();
            obj.put("type", "HR");
            obj.put("bpm", bpm);
            if (localAvgHrBpm >= 30) obj.put("avgBpm", localAvgHrBpm);
            if (localMaxHrBpm >= 30) obj.put("maxBpm", localMaxHrBpm);
            obj.put("status", status);
            obj.put("deviceName", getWatchDisplayName());
            obj.put("_ts", now);
            String payloadStr = obj.toString();
            sendToPhone("/archery101010/hr", payloadStr, false);

            // Also sync via urgent DataClient item whenever BPM/status changes or every 3.5s
            // so Wear OS live pulse works reliably even if ephemeral MessageClient drops packets.
            String safeStatus = status != null ? status : "ok";
            if (bpm != lastHrDataItemSentBpm
                    || !safeStatus.equals(lastHrDataItemSentStatus)
                    || (now - lastHrDataItemSentMs) >= HR_DATA_ITEM_INTERVAL_MS) {
                lastHrDataItemSentBpm = bpm;
                lastHrDataItemSentStatus = safeStatus;
                lastHrDataItemSentMs = now;
                try {
                    PutDataMapRequest putReq = PutDataMapRequest.create("/archery101010/hr");
                    putReq.getDataMap().putString("hr_json", payloadStr);
                    putReq.getDataMap().putInt("bpm", bpm);
                    putReq.getDataMap().putString("status", safeStatus);
                    putReq.getDataMap().putLong("sent_at", now);
                    Wearable.getDataClient(this).putDataItem(putReq.asPutDataRequest().setUrgent());
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    private void requestHeartRatePermissionInteractive() {
        if (hasHeartRatePermission()) {
            heartRateSensor = null;
            startHeartRateStreaming(false, false);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String perm = getRequiredHeartRatePermission();
            boolean shouldShow = false;
            try {
                shouldShow = shouldShowRequestPermissionRationale(perm);
            } catch (Exception ignored) {}
            if (hrPermissionDeniedCount >= 2 && !shouldShow) {
                try {
                    Intent settingsIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    settingsIntent.setData(Uri.fromParts("package", getPackageName(), null));
                    settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(settingsIntent);
                    return;
                } catch (Exception ignored) {}
            }
            hrPermissionRequestedThisRun = true;
            hrPermissionPromptInFlight = true;
            try {
                requestPermissions(new String[]{perm}, REQ_HEART_RATE);
            } catch (Exception ignored) {
                hrPermissionPromptInFlight = false;
            }
        }
    }

    private synchronized void startHeartRateStreaming(boolean allowPermissionPrompt) {
        startHeartRateStreaming(allowPermissionPrompt, false);
    }

    private synchronized void startHeartRateStreaming(boolean allowPermissionPrompt, boolean forcePrompt) {
        if (sensorManager == null) return;
        // CRITICAL (Samsung Galaxy Watch / Wear OS 4-6): ALWAYS check & request HR permission FIRST
        // BEFORE calling getDefaultSensor(TYPE_HEART_RATE), because Wear OS hides/returns null
        // for TYPE_HEART_RATE while BODY_SENSORS / READ_HEART_RATE is not granted!
        if (!hasHeartRatePermission()) {
            hrStatusCode = "permission_denied";
            if (allowPermissionPrompt && !hrPermissionPromptInFlight
                    && (forcePrompt || !hrPermissionRequestedThisRun)
                    && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                hrPermissionRequestedThisRun = true;
                hrPermissionPromptInFlight = true;
                final String perm = getRequiredHeartRatePermission();
                runOnUiThread(() -> {
                    try {
                        requestPermissions(new String[]{perm}, REQ_HEART_RATE);
                    } catch (Exception ignored) {
                        hrPermissionPromptInFlight = false;
                    }
                });
            } else {
                sendHeartRateToPhone(0, "permission_denied");
            }
            runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
            return;
        }

        if (heartRateSensor == null) {
            heartRateSensor = sensorManager.getDefaultSensor(Sensor.TYPE_HEART_RATE);
            if (heartRateSensor == null) {
                try {
                    List<Sensor> hrList = sensorManager.getSensorList(Sensor.TYPE_HEART_RATE);
                    if (hrList != null && !hrList.isEmpty()) {
                        heartRateSensor = hrList.get(0);
                    }
                } catch (Exception ignored) {}
            }
        }
        if (heartRateSensor == null) {
            hrStatusCode = "no_sensor";
            sendHeartRateToPhone(0, "no_sensor");
            runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
            return;
        }
        long now = System.currentTimeMillis();
        if (!isHrSensorRegistered) {
            try {
                isHrSensorRegistered = sensorManager.registerListener(
                        heartRateListener, heartRateSensor, SensorManager.SENSOR_DELAY_NORMAL);
                if (isHrSensorRegistered && localSensorHrBpm < 30) {
                    hrStatusCode = "reading";
                    sendHeartRateToPhone(0, "reading");
                }
            } catch (Exception ignored) {
                isHrSensorRegistered = false;
            }
            runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
        } else if (isLocalHeartRateFresh()) {
            lastHrSentMs = now;
            sendHeartRateToPhone(localSensorHrBpm, "ok");
            if (hasPairingCode && pairingCode.length() == 6 && !isEditingCode) {
                lastCloudHrPushMs = now;
                lastCloudHrPushedBpm = localSensorHrBpm;
                lastCloudHeartbeatTouchMs = now;
                touchWatchHeartbeatInFirestore(pairingCode, now);
            }
        } else {
            // Re-trigger hardware REPORTING_MODE_ON_CHANGE sample when phone explicitly requests HR
            try {
                sensorManager.unregisterListener(heartRateListener);
                isHrSensorRegistered = sensorManager.registerListener(
                        heartRateListener, heartRateSensor, SensorManager.SENSOR_DELAY_NORMAL);
            } catch (Exception ignored) {}
            if ("reading".equals(hrStatusCode) || localSensorHrBpm < 30) {
                hrStatusCode = "reading";
                sendHeartRateToPhone(0, "reading");
            }
        }
        if (isHrSensorRegistered) {
            heartbeatHandler.removeCallbacks(hrKeepaliveRunnable);
            heartbeatHandler.postDelayed(hrKeepaliveRunnable, HR_KEEPALIVE_INTERVAL_MS);
        }
    }

    private synchronized void stopHeartRateStreaming() {
        heartbeatHandler.removeCallbacks(hrKeepaliveRunnable);
        if (sensorManager != null && isHrSensorRegistered) {
            try {
                sensorManager.unregisterListener(heartRateListener);
            } catch (Exception ignored) {}
        }
        isHrSensorRegistered = false;
        localSensorHrBpm = 0;
    }
    private int lastAnalysisShotNum = 0;
    private float lastPrepSec = 0f;
    private float lastAimSec = 0f;
    private float lastSwayCm = 0f;
    private int lastStabilityPct = 0;
    private int lastShotHrBpm = 0;
    private float[] lastPrepX = new float[0];
    private float[] lastPrepY = new float[0];
    private float[] lastAimX = new float[0];
    private float[] lastAimY = new float[0];
    private float lastRelX = 0f;
    private float lastRelY = 0f;
    private long lastHandledManualCaptureAt = 0L;
    private long lastHandledCalibrateZeroAt = 0L;
    private volatile long lastCloudHeartbeatTouchMs = 0L;
    private double calZeroAx = 0.0;
    private double calZeroAy = 0.0;
    private double calZeroAz = 9.81;
    private boolean hasCalZeroVec = false;

    // Post-release 220ms follow-through verification state (eliminates target arrow yanks & arm flings)
    private boolean pendingShotActive = false;
    private long pendingShotStartMs = 0L;
    private int pendingFollowSamples = 0;
    private double pendingFollowSumLin = 0.0;
    private double pendingFollowSumAx = 0.0;
    private double pendingFollowSumGyro = 0.0;
    private int pendingFollowGyroSamples = 0;

    // Sensitive arm-swing / bow-carry walking cadence peaks
    private final long[] motionPeakT = new long[8];
    private int motionPeakIdx = 0;
    private long lastMotionPeakMs = 0L;
    private double prevDyn = 0.0;
    private double prevPrevDyn = 0.0;

    // Zero-permission linear-accel rhythmic cadence tracker (prevents isolated bow raises/draws from counting as steps)
    private final long[] accelCandidateStepT = new long[4];
    private int accelCandidateStepCount = 0;
    private boolean accelRhythmicCadenceActive = false;
    private double prevDynLinear = 0.0;
    private double prevPrevDynLinear = 0.0;

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

    // 6-Digit Cloud Pairing state
    private final int[] pairingDigits = new int[]{1, 0, 1, 0, 1, 0};
    private boolean hasPairingCode = false;
    private String pairingCode = "";
    private boolean isEditingCode = false;
    private int editDigitPos = 0;
    private volatile boolean isCloudSynced = false;
    private volatile String cloudLinkStatus = ""; // "" | LINKING | SYNCED | NOT_FOUND | NO_NET
    private final ExecutorService cloudExecutor = Executors.newSingleThreadExecutor();

    // Connection & sync race-condition guards
    private volatile boolean isPhoneConnected = false;
    private volatile long lastPhoneSyncMs = 0L;
    private volatile long lastLocalActionTimeMs = 0L;
    private volatile long lastActivityMs = System.currentTimeMillis();
    private volatile long lastCloudPollMs = 0L;
    private volatile String lastRemoteCloudSig = "";
    private volatile String lastPhoneStateSig = "";
    private volatile long lastFinishedTimestampMs = 0L;
    private volatile String currentSessionId = "";
    private volatile String lastFinishedSessionId = "";
    private volatile long cmdSequence = 0L;
    private volatile long pendingCmdSeq = 0L;
    private volatile long lastAckedCmdSeq = 0L;
    private int mPendingUnackedDelta = 0;
    private long mLastDataItemNonceMs = 0L;

    private MessageClient.OnMessageReceivedListener messageListener = null;
    private DataClient.OnDataChangedListener dataListener = null;
    private final Handler heartbeatHandler = new Handler(Looper.getMainLooper());
    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            long now = System.currentTimeMillis();
            sendToPhone("{\"type\":\"REQUEST_STATE\"}");
            if (stepsCount > lastSyncedStepsCount) {
                syncTelemetryToPhone();
            }
            if (hasPairingCode && pairingCode.length() == 6 && !isEditingCode) {
                long cloudIntervalMs = getAdaptiveCloudPollIntervalMs(now);
                if (lastCloudPollMs == 0L || (now - lastCloudPollMs) >= (cloudIntervalMs - 150L)) {
                    pollFirestoreCloud();
                }
            }
            checkPhoneNodeConnectivity();
            scheduleNextHeartbeat();
        }
    };

    private long getAdaptiveCloudPollIntervalMs(long now) {
        long idleMs = Math.max(0L, now - lastActivityMs);
        boolean wearDataLayerRecent = isPhoneConnected
                && lastPhoneSyncMs > 0L
                && (now - lastPhoneSyncMs) < 30_000L;
        // 3-Tier Adaptive Cloud Polling:
        // Active (< 90s): 5,000 ms standalone, or 20,000 ms if direct Bluetooth Wear Data Layer was active in last 30s
        // Warm Idle (90s..5m): 20,000 ms
        // Deep Idle (>= 5m): 45,000 ms
        if (idleMs < 90_000L) {
            return wearDataLayerRecent ? 20_000L : 5_000L;
        } else if (idleMs < 300_000L) {
            return 20_000L;
        }
        return 45_000L;
    }

    private long getAdaptiveHeartbeatDelayMs(long now) {
        long idleMs = Math.max(0L, now - lastActivityMs);
        if (idleMs < 90_000L) {
            return 5_000L;
        } else if (idleMs < 300_000L) {
            return 20_000L;
        }
        return 45_000L;
    }

    private void scheduleNextHeartbeat() {
        long delayMs = getAdaptiveHeartbeatDelayMs(System.currentTimeMillis());
        heartbeatHandler.removeCallbacks(heartbeatRunnable);
        heartbeatHandler.postDelayed(heartbeatRunnable, delayMs);
    }

    private void markUserActivity(boolean isWriteAction) {
        long now = System.currentTimeMillis();
        lastActivityMs = now;
        if (isWriteAction) {
            lastLocalActionTimeMs = now;
        } else if (hasPairingCode && pairingCode.length() == 6 && !isEditingCode
                && (now - lastLocalActionTimeMs) >= 3_500L) {
            long targetIntervalMs = getAdaptiveCloudPollIntervalMs(now);
            if (lastCloudPollMs == 0L || (now - lastCloudPollMs) >= targetIntervalMs) {
                pollFirestoreCloud();
            }
        }
        scheduleNextHeartbeat();
    }

    private WearCanvasView canvasView;
    private boolean isBackCallbackRegistered = false;
    private Object wearBackInvokedCallback = null;

    private final Runnable manualTimerRunnable = new Runnable() {
        @Override
        public void run() {
            if (!manualAnalysisRecording || !analysisMode) return;
            if (System.currentTimeMillis() - manualAnalysisStartMs >= 30_000L) {
                stopManualAnalysisCapture(true);
                return;
            }
            if (canvasView != null) {
                canvasView.invalidate();
            }
            heartbeatHandler.postDelayed(this, 150L);
        }
    };

    private void triggerDoubleHaptic() {
        try {
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0L, 55L, 45L, 90L}, -1));
            } else {
                vibrator.vibrate(new long[]{0L, 55L, 45L, 90L}, -1);
            }
        } catch (Exception ignored) {}
    }

    private void startManualAnalysisCapture(boolean notifyPhone) {
        if (!analysisMode) return;
        long now = System.currentTimeMillis();
        if (manualAnalysisRecording) return;
        manualAnalysisRecording = true;
        manualAnalysisStartMs = now;
        pendingShotActive = false;
        analysisPage = 0;
        markUserActivity(true);
        triggerHaptic(60);
        heartbeatHandler.removeCallbacks(manualTimerRunnable);
        heartbeatHandler.postDelayed(manualTimerRunnable, 150L);
        if (notifyPhone) {
            try {
                JSONObject cmd = new JSONObject();
                cmd.put("type", "ANALYSIS_MANUAL_START");
                cmd.put("ts", now);
                cmd.put("source", "watch_manual");
                sendToPhone(cmd.toString());
            } catch (Exception ignored) {}
        }
        syncBackNavigationCallback();
        if (canvasView != null) canvasView.invalidate();
    }

    private void stopManualAnalysisCapture(boolean notifyPhoneStopIfNoSamples) {
        if (!manualAnalysisRecording) return;
        long endMs = System.currentTimeMillis();
        long startMs = manualAnalysisStartMs;
        manualAnalysisRecording = false;
        manualAnalysisStartMs = 0L;
        heartbeatHandler.removeCallbacks(manualTimerRunnable);
        markUserActivity(true);
        triggerDoubleHaptic();
        boolean emitted = emitWearAnalysisShot(startMs, endMs, "watch_manual");
        if (!emitted && notifyPhoneStopIfNoSamples) {
            try {
                JSONObject cmd = new JSONObject();
                cmd.put("type", "ANALYSIS_MANUAL_STOP");
                cmd.put("ts", endMs);
                cmd.put("source", "watch_manual");
                sendToPhone(cmd.toString());
            } catch (Exception ignored) {}
        }
        syncBackNavigationCallback();
        if (canvasView != null) canvasView.invalidate();
    }

    private void toggleManualAnalysisFromWatchHardware() {
        long now = System.currentTimeMillis();
        if (now - lastPhysicalButtonToggleMs < 400L) return;
        lastPhysicalButtonToggleMs = now;
        lastWatchTapMs = now;
        if (manualAnalysisRecording) {
            stopManualAnalysisCapture(true);
        } else {
            startManualAnalysisCapture(true);
        }
    }

    private boolean canHandleWatchBackNavigation() {
        if (isEditingCode) return true;
        if (analysisMode) return true;
        return screenIndex > 0;
    }

    private boolean handleWatchBackNavigation() {
        if (isEditingCode) {
            isEditingCode = false;
        } else if (analysisMode && analysisPage > 0) {
            analysisPage = 0;
        } else if (analysisMode && analysisPage == 0) {
            toggleManualAnalysisFromWatchHardware();
            return true;
        } else if (!analysisMode && screenIndex > 0) {
            screenIndex = screenIndex - 1;
        } else {
            return false;
        }
        markUserActivity(false);
        triggerHaptic(20);
        syncBackNavigationCallback();
        if (canvasView != null) canvasView.invalidate();
        return true;
    }

    private long lastRotaryActionMs = 0L;

    private boolean isHardwareActionKeyCode(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_STEM_PRIMARY
                || keyCode == KeyEvent.KEYCODE_STEM_1
                || keyCode == KeyEvent.KEYCODE_STEM_2
                || keyCode == KeyEvent.KEYCODE_STEM_3
                || keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_BUTTON_START
                || keyCode == KeyEvent.KEYCODE_BUTTON_A
                || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                || keyCode == KeyEvent.KEYCODE_VOLUME_UP
                || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN;
    }

    private boolean handlePhysicalWatchKeyAction(int keyCode) {
        if (isHardwareActionKeyCode(keyCode)) {
            if (analysisMode) {
                toggleManualAnalysisFromWatchHardware();
                return true;
            }
            if (screenIndex == 0 && canvasView != null) {
                long now = System.currentTimeMillis();
                if (now - lastPhysicalButtonToggleMs >= 320L) {
                    lastPhysicalButtonToggleMs = now;
                    lastWatchTapMs = now;
                    canvasView.incrementArrowManually();
                }
                return true;
            }
            if (screenIndex == 4) {
                long now = System.currentTimeMillis();
                if (now - lastPhysicalButtonToggleMs >= 300L) {
                    lastPhysicalButtonToggleMs = now;
                    if (!isEditingCode) {
                        isEditingCode = true;
                        editDigitPos = 0;
                        markUserActivity(true);
                        triggerHaptic(20);
                        if (canvasView != null) canvasView.invalidate();
                    } else if (editDigitPos < 5) {
                        editDigitPos++;
                        markUserActivity(true);
                        triggerHaptic(20);
                        if (canvasView != null) canvasView.invalidate();
                    } else {
                        commitPairingDigits();
                    }
                }
                return true;
            }
        }
        if (keyCode == KeyEvent.KEYCODE_BACK && analysisMode && analysisPage == 0) {
            toggleManualAnalysisFromWatchHardware();
            return true;
        }
        return false;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event != null && event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            if (handlePhysicalWatchKeyAction(event.getKeyCode())) {
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (event != null && event.getRepeatCount() > 0) {
            return super.onKeyDown(keyCode, event);
        }
        if (handlePhysicalWatchKeyAction(keyCode)) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onGenericMotionEvent(MotionEvent event) {
        if (event != null && event.getAction() == MotionEvent.ACTION_SCROLL
                && (event.isFromSource(InputDevice.SOURCE_ROTARY_ENCODER)
                    || event.isFromSource(InputDevice.SOURCE_CLASS_POINTER))) {
            float delta = -event.getAxisValue(MotionEvent.AXIS_SCROLL);
            if (Math.abs(delta) >= 0.05f) {
                long now = System.currentTimeMillis();
                if (now - lastRotaryActionMs >= 160L) {
                    lastRotaryActionMs = now;
                    int dir = delta > 0f ? 1 : -1;
                    if (screenIndex == 4 && !analysisMode) {
                        adjustSelectedCodeDigit(dir);
                        return true;
                    }
                    if (analysisMode) {
                        analysisPage = (dir > 0) ? 1 : 0;
                        syncBackNavigationCallback();
                        markUserActivity(false);
                        triggerHaptic(15);
                        if (canvasView != null) canvasView.invalidate();
                        return true;
                    }
                    screenIndex = (dir > 0) ? ((screenIndex + 1) % 5) : ((screenIndex + 4) % 5);
                    isEditingCode = false;
                    syncBackNavigationCallback();
                    markUserActivity(false);
                    triggerHaptic(15);
                    if (canvasView != null) canvasView.invalidate();
                    return true;
                }
            }
        }
        return super.onGenericMotionEvent(event);
    }

    private void syncBackNavigationCallback() {
        if (Build.VERSION.SDK_INT >= 33) {
            boolean shouldRegister = canHandleWatchBackNavigation();
            if (shouldRegister && !isBackCallbackRegistered) {
                try {
                    if (wearBackInvokedCallback == null) {
                        wearBackInvokedCallback = (android.window.OnBackInvokedCallback) this::handleWatchBackNavigation;
                    }
                    getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                            (android.window.OnBackInvokedCallback) wearBackInvokedCallback
                    );
                    isBackCallbackRegistered = true;
                } catch (Throwable ignored) {}
            } else if (!shouldRegister && isBackCallbackRegistered && wearBackInvokedCallback != null) {
                try {
                    getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(
                            (android.window.OnBackInvokedCallback) wearBackInvokedCallback
                    );
                } catch (Throwable ignored) {}
                isBackCallbackRegistered = false;
            }
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (handleWatchBackNavigation()) {
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstanceRef = new WeakReference<>(this);
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
        currentSessionId = prefs.getString("currentSessionId", "");
        String savedCode = prefs.getString("pairingCode", "");
        if (savedCode != null && savedCode.length() == 6) {
            pairingCode = savedCode;
            hasPairingCode = true;
            parsePairingDigitsFromString(savedCode);
        }
        arrowCount = prefs.getInt("arrowCount", 0);
        totalScore = prefs.getInt("totalScore", 0);
        totalScoredArrows = prefs.getInt("totalScoredArrows", 0);
        currentEnd = prefs.getInt("currentEnd", 1);
        stepsCount = prefs.getInt("stepsCount", 0);
        distanceWalkedM = prefs.getFloat("walkedMeters", 0f);
        syncedArrowsPerEnd = Math.max(1, prefs.getInt("syncedArrowsPerEnd", 6));
        syncedEndsCount = Math.max(1, prefs.getInt("syncedEndsCount", 12));
        autoDetectEnabled = false;
        prefs.edit().putBoolean("autoDetectEnabled_v2", false).apply();
        sensitivityLevel = Math.max(0, Math.min(2, prefs.getInt("sensitivityLevel", 1)));
        cmdSequence = prefs.getLong("cmdSequence", 0L);
        mPendingUnackedDelta = prefs.getInt("pendingUnackedDelta", 0);

        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            gyroscope = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

        canvasView = new WearCanvasView(this);
        setContentView(canvasView);
        canvasView.requestFocus();

        ensureSensorAndHeartbeatActive();
        initWearCommunication();
        syncBackNavigationCallback();
        if (hasHeartRatePermission()) {
            startHeartRateStreaming(false, false);
        } else {
            // Defer HR permission prompt until Wear OS Activity window attaches (Samsung One UI Watch)
            canvasView.postDelayed(() -> {
                if (!isFinishing() && !hasHeartRatePermission() && !hrPermissionRequestedThisRun) {
                    startHeartRateStreaming(true, false);
                }
            }, 450L);
        }
        if (hasPairingCode && pairingCode.length() == 6) {
            pollFirestoreCloud();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            if (canvasView != null) canvasView.requestFocus();
            if (!hasHeartRatePermission() && !hrPermissionRequestedThisRun && !hrPermissionPromptInFlight) {
                startHeartRateStreaming(true, false);
            } else if (hasHeartRatePermission() && !isHrSensorRegistered) {
                startHeartRateStreaming(false, false);
            }
        }
    }

    private boolean hasMicPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_HEART_RATE) {
            hrPermissionPromptInFlight = false;
            if (hasHeartRatePermission()) {
                hrPermissionDeniedCount = 0;
                heartRateSensor = null; // Re-query freshly now that Wear OS granted HR permission
                startHeartRateStreaming(false, false);
            } else {
                hrPermissionDeniedCount++;
                hrStatusCode = "permission_denied";
                sendHeartRateToPhone(0, "permission_denied");
            }
            if (canvasView != null) canvasView.invalidate();
            return;
        }
        if (requestCode == REQ_MIC_AUTO_SHOT) {
            boolean granted = grantResults != null
                    && grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted && autoDetectEnabled) {
                micDeniedNoticeUntilMs = 0L;
                syncShotDetectionSensors();
            } else {
                // Dual-Key requires both wrist IMU and real-time string-snap audio; never fall back to motion-only
                autoDetectEnabled = false;
                micDeniedNoticeUntilMs = System.currentTimeMillis() + 4500L;
                syncShotDetectionSensors();
                saveState();
                sendToPhone("{\"type\":\"TOGGLE_AUTO_DETECT\",\"enabled\":false,\"sensitivityLevel\":" + sensitivityLevel + "}");
            }
            if (canvasView != null) canvasView.invalidate();
        }
    }

    private synchronized void startAcousticSnapAnalyzer() {
        if (isAcousticAnalyzerRunning || !hasMicPermission()) return;
        isAcousticAnalyzerRunning = true;
        acousticAnalyzerThread = new Thread(() -> {
            AudioRecord recorder = null;
            try {
                int minBuf = AudioRecord.getMinBufferSize(
                        AUDIO_SAMPLE_RATE_HZ,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT
                );
                if (minBuf <= 0) {
                    isAcousticAnalyzerRunning = false;
                    return;
                }
                int bufferSizeBytes = Math.max(minBuf * 2, AUDIO_FRAME_SAMPLES * 8);
                // VOICE_RECOGNITION disables speech AGC/noise-suppression so <25ms bowstring snaps are never attenuated
                try {
                    recorder = new AudioRecord(
                            MediaRecorder.AudioSource.VOICE_RECOGNITION,
                            AUDIO_SAMPLE_RATE_HZ,
                            AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT,
                            bufferSizeBytes
                    );
                } catch (Exception ignored) {}
                if (recorder == null || recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                    if (recorder != null) {
                        try { recorder.release(); } catch (Exception ignored) {}
                    }
                    recorder = new AudioRecord(
                            MediaRecorder.AudioSource.MIC,
                            AUDIO_SAMPLE_RATE_HZ,
                            AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT,
                            bufferSizeBytes
                    );
                }
                if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                    recorder.release();
                    isAcousticAnalyzerRunning = false;
                    return;
                }

                recorder.startRecording();
                short[] pcm = new short[AUDIO_FRAME_SAMPLES];
                float prevSample = 0f;
                double noiseFloorRms = 45.0;
                int warmupFrames = 0;

                boolean inCandidate = false;
                long candidateStartMs = 0L;
                double candidatePeakRms = 0.0;
                int candidateSustainedFrames = 0;
                boolean waitQuietReset = false;

                while (isAcousticAnalyzerRunning && !Thread.currentThread().isInterrupted()) {
                    int read = recorder.read(pcm, 0, AUDIO_FRAME_SAMPLES);
                    if (read <= 0) continue;

                    double sumSq = 0.0;
                    double maxAbs = 0.0;
                    for (int i = 0; i < read; i++) {
                        float s = pcm[i];
                        // First-order high-pass pre-emphasis (>1.6 kHz) strips voices, footsteps, wind & bass music
                        float hp = s - (0.88f * prevSample);
                        prevSample = s;
                        double absHp = Math.abs(hp);
                        if (absHp > maxAbs) maxAbs = absHp;
                        sumSq += (double) hp * (double) hp;
                        pcm[i] = 0; // Immediately zero volatile sample
                    }

                    double hfRms = Math.sqrt(sumSq / read);
                    long frameNow = System.currentTimeMillis();

                    if (warmupFrames < 8) {
                        noiseFloorRms = (warmupFrames == 0)
                                ? Math.max(20.0, Math.min(2200.0, hfRms))
                                : (0.75 * noiseFloorRms + 0.25 * Math.max(20.0, Math.min(2200.0, hfRms)));
                        warmupFrames++;
                        continue;
                    }

                    int sens = sensitivityLevel;
                    double snrMult = (sens == 0) ? 4.6 : ((sens == 2) ? 2.8 : 3.6);
                    double minAbsRms = (sens == 0) ? 120.0 : ((sens == 2) ? 56.0 : 84.0);
                    double crestMin = (sens == 0) ? 2.20 : ((sens == 2) ? 1.82 : 2.00);

                    if (waitQuietReset) {
                        if (hfRms < Math.max(minAbsRms * 0.85, noiseFloorRms * 1.75)) {
                            waitQuietReset = false;
                        } else {
                            noiseFloorRms = Math.max(20.0, Math.min(2800.0, 0.985 * noiseFloorRms + 0.015 * hfRms));
                            continue;
                        }
                    }

                    if (!inCandidate) {
                        double triggerRms = Math.max(minAbsRms, noiseFloorRms * snrMult);
                        if (hfRms >= triggerRms && maxAbs >= (hfRms * crestMin)) {
                            inCandidate = true;
                            candidateStartMs = frameNow;
                            candidatePeakRms = hfRms;
                            candidateSustainedFrames = 1;
                        } else if (hfRms < noiseFloorRms * 2.1) {
                            noiseFloorRms = Math.max(20.0, Math.min(2800.0, 0.965 * noiseFloorRms + 0.035 * hfRms));
                        }
                    } else {
                        if (hfRms > candidatePeakRms) {
                            candidatePeakRms = hfRms;
                        }
                        if (hfRms > candidatePeakRms * 0.52) {
                            candidateSustainedFrames++;
                            // Reject sustained sounds (> 90ms: shouting, whistles, wind gusts, music)
                            if (candidateSustainedFrames > 9) {
                                inCandidate = false;
                                waitQuietReset = true;
                            }
                        } else {
                            // Crisp < 90ms percussive decay confirmed -> valid bowstring / release snap!
                            lastVerifiedAcousticSnapMs = candidateStartMs;
                            inCandidate = false;
                        }
                    }
                }
            } catch (SecurityException | IllegalStateException ignored) {
            } finally {
                if (recorder != null) {
                    try { recorder.stop(); } catch (Exception ignored) {}
                    try { recorder.release(); } catch (Exception ignored) {}
                }
                isAcousticAnalyzerRunning = false;
            }
        }, "ArcheryDualKeyAudioDSP");
        acousticAnalyzerThread.setDaemon(true);
        acousticAnalyzerThread.start();
    }

    private synchronized void stopAcousticSnapAnalyzer() {
        isAcousticAnalyzerRunning = false;
        lastVerifiedAcousticSnapMs = 0L;
        if (acousticAnalyzerThread != null) {
            try {
                acousticAnalyzerThread.interrupt();
            } catch (Exception ignored) {}
            acousticAnalyzerThread = null;
        }
    }

    private synchronized void syncShotDetectionSensors() {
        autoDetectEnabled = false;
        stopAcousticSnapAnalyzer();
        if (sensorManager == null || accelerometer == null) return;
        boolean wantHighRate = analysisMode;
        if (isSensorRegistered && isSensorHighRateMode == wantHighRate) {
            return;
        }
        if (isSensorRegistered) {
            try {
                sensorManager.unregisterListener(this);
            } catch (Exception ignored) {}
            isSensorRegistered = false;
        }
        try {
            if (wantHighRate) {
                sensorManager.registerListener(this, accelerometer, SENSOR_RATE_100HZ_US);
                if (gyroscope != null) {
                    sensorManager.registerListener(this, gyroscope, SENSOR_RATE_100HZ_US);
                }
                isSensorHighRateMode = true;
            } else {
                pendingShotActive = false;
                // Keep 50Hz zero-permission accelerometer active so wrist footsteps & walked meters
                // are accurately recorded even in 100% Manual Counter Mode!
                sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
                isSensorHighRateMode = false;
            }
            isSensorRegistered = true;
        } catch (Exception ignored) {}
    }

    private void ensureSensorAndHeartbeatActive() {
        syncShotDetectionSensors();
        scheduleNextHeartbeat();
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
                if ("/archery101010/hr_request".equals(path)) {
                    runOnUiThread(() -> startHeartRateStreaming(true, true));
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
                        if (item != null && item.getUri() != null) {
                            String itemPath = item.getUri().getPath();
                            if ("/archery101010/state".equals(itemPath)) {
                                DataMap dataMap = DataMapItem.fromDataItem(item).getDataMap();
                                String snapshotJson = dataMap.getString("snapshot_json", "");
                                if (snapshotJson != null && !snapshotJson.isEmpty()) {
                                    isPhoneConnected = true;
                                    lastPhoneSyncMs = System.currentTimeMillis();
                                    handleIncomingPhonePayload(snapshotJson);
                                }
                            } else if ("/archery101010/hr_request".equals(itemPath)) {
                                isPhoneConnected = true;
                                lastPhoneSyncMs = System.currentTimeMillis();
                                runOnUiThread(() -> startHeartRateStreaming(true, true));
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

            // Sensitivity chosen on the phone (BAJA / MEDIA / ALTA) must drive the watch detector too
            String rootType = rootObj.optString("type", "");
            if ("ANALYSIS_MANUAL_START".equals(rootType)) {
                lastHandledManualStartAt = rootObj.optLong("ts", System.currentTimeMillis());
                runOnUiThread(() -> {
                    if (!analysisMode) {
                        analysisMode = true;
                        syncShotDetectionSensors();
                    }
                    analysisAutoMode = false;
                    startManualAnalysisCapture(false);
                });
                return;
            }
            if ("ANALYSIS_MANUAL_STOP".equals(rootType)) {
                lastHandledManualStopAt = rootObj.optLong("ts", System.currentTimeMillis());
                runOnUiThread(() -> stopManualAnalysisCapture(false));
                return;
            }
            if ("ANALYSIS_MANUAL_CAPTURE".equals(rootType)) {
                lastHandledManualCaptureAt = System.currentTimeMillis();
                runOnUiThread(() -> {
                    if (manualAnalysisRecording) {
                        stopManualAnalysisCapture(false);
                    } else {
                        emitWearAnalysisShot(0L, System.currentTimeMillis(), "watch_manual");
                    }
                });
                return;
            }
            if ("ANALYSIS_CALIBRATE_ZERO".equals(rootType)) {
                lastHandledCalibrateZeroAt = System.currentTimeMillis();
                heartbeatHandler.postDelayed(this::captureWearZeroGravityVector, 2000L);
                return;
            }
            if ("SET_SENSITIVITY".equals(rootType) || "TOGGLE_AUTO_DETECT".equals(rootType)) {
                if (rootObj.has("sensitivityLevel")) {
                    sensitivityLevel = Math.max(0, Math.min(2, rootObj.optInt("sensitivityLevel", sensitivityLevel)));
                }
                autoDetectEnabled = false;
                lastActivityMs = System.currentTimeMillis();
                syncShotDetectionSensors();
                saveState();
                runOnUiThread(() -> {
                    scheduleNextHeartbeat();
                    if (canvasView != null) canvasView.invalidate();
                });
                return;
            }
            if (obj.has("sensitivityLevel")) {
                sensitivityLevel = Math.max(0, Math.min(2, obj.optInt("sensitivityLevel", sensitivityLevel)));
            }

            long now = System.currentTimeMillis();
            isPhoneConnected = true;
            lastPhoneSyncMs = now;

            String incomingSessionId = obj.optString("sessionId", "");
            int incomingArrows = obj.optInt("arrowsCount", -1);
            boolean sessionActive = obj.optBoolean("sessionActive", rootObj.optBoolean("sessionActive", true));

            StringBuilder phoneEndArrowsSb = new StringBuilder();
            JSONArray phoneArr = obj.optJSONArray("currentEndArrows");
            if (phoneArr != null) {
                for (int i = 0; i < phoneArr.length(); i++) {
                    if (i > 0) phoneEndArrowsSb.append(',');
                    phoneEndArrowsSb.append(phoneArr.optString(i, ""));
                }
            }
            boolean incomingAnalysisMode = obj.optBoolean(
                    "analysisMode",
                    "Análisis".equals(obj.optString("practiceType", ""))
            );
            String incomingCalStr = obj.optString("analysisCalibrationJson", "");
            if (!incomingCalStr.isEmpty()) {
                try {
                    JSONObject cal = new JSONObject(incomingCalStr);
                    String bw = cal.optString("bowWrist", syncedBowWrist);
                    if ("LEFT".equals(bw) || "RIGHT".equals(bw)) syncedBowWrist = bw;
                } catch (Exception ignored) {}
            }

            String nextPhoneSig = (sessionActive ? "1|" : "0|") + incomingSessionId + "|"
                    + incomingArrows + "|" + obj.optInt("totalScore", totalScore) + "|"
                    + obj.optInt("currentEndIndex", currentEnd - 1) + "|" + phoneEndArrowsSb + "|"
                    + obj.optInt("distanceM", distanceMeters) + "|"
                    + (obj.optBoolean("autoDetectEnabled", autoDetectEnabled) ? "1|" : "0|")
                    + sensitivityLevel + "|" + (incomingAnalysisMode ? "1|" : "0|") + incomingCalStr;
            boolean phoneStateChanged = false;
            if (lastPhoneStateSig.isEmpty()) {
                lastPhoneStateSig = nextPhoneSig;
            } else if (!nextPhoneSig.equals(lastPhoneStateSig)) {
                lastPhoneStateSig = nextPhoneSig;
                lastActivityMs = now;
                phoneStateChanged = true;
            }
            final boolean shouldRescheduleFromPhone = phoneStateChanged;

            if (!sessionActive) {
                if (analysisMode) {
                    analysisMode = false;
                    syncShotDetectionSensors();
                }
                if (incomingArrows <= 0) {
                    lastFinishedSessionId = "";
                }
                if ((now - lastLocalActionTimeMs) >= 4000L || incomingArrows <= 0) {
                    resetWatchSessionCounters(true);
                    runOnUiThread(() -> {
                        if (shouldRescheduleFromPhone) scheduleNextHeartbeat();
                        if (canvasView != null) canvasView.invalidate();
                    });
                } else {
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
                if (!incomingSessionId.equals(currentSessionId)) {
                    // New session started on phone: reset all previous session counters & steps to zero
                    resetWatchSessionCounters(false);
                    currentSessionId = incomingSessionId;
                }
            }

            if (obj.has("arrowsCount") && incomingArrows == arrowCount) {
                mPendingUnackedDelta = 0;
            }

            long unackedProtectMs = (mPendingUnackedDelta != 0) ? 20000L : 6000L;
            boolean hasUnackedLocalAction =
                ((now - lastLocalActionTimeMs) < unackedProtectMs) &&
                (mPendingUnackedDelta != 0 || pendingCmdSeq == 0L || incomingAckSeq < pendingCmdSeq);

            if (obj.has("arrowsCount")) {
                if (hasUnackedLocalAction) {
                    syncedArrowsCount = Math.max(0, incomingArrows);
                } else {
                    arrowCount = Math.max(0, incomingArrows);
                    syncedArrowsCount = arrowCount;
                    totalScoredArrows = arrowCount;
                    mPendingUnackedDelta = 0;
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
            if (obj.has("bowType")) {
                String bt = obj.optString("bowType", syncedBowType);
                if (!bt.isEmpty()) syncedBowType = bt;
            }
            if (obj.has("heartRateBpm") && !isLocalHeartRateFresh()) {
                syncedHeartRateBpm = obj.optInt("heartRateBpm", 0);
            }
            if (obj.has("analysisCalibrationJson")) {
                try {
                    JSONObject cal = new JSONObject(obj.optString("analysisCalibrationJson", "{}"));
                    String bw = cal.optString("bowWrist", syncedBowWrist);
                    if ("LEFT".equals(bw) || "RIGHT".equals(bw)) syncedBowWrist = bw;
                    long reqStartAt = cal.optLong("manualStartAt", 0L);
                    long reqStopAt = cal.optLong("manualStopAt", 0L);
                    if (reqStartAt > 0L
                            && reqStartAt != lastHandledManualStartAt
                            && (now - reqStartAt) <= 25_000L
                            && reqStopAt < reqStartAt) {
                        lastHandledManualStartAt = reqStartAt;
                        runOnUiThread(() -> startManualAnalysisCapture(false));
                    }
                    if (reqStopAt > 0L
                            && reqStopAt != lastHandledManualStopAt
                            && (now - reqStopAt) <= 15_000L) {
                        if (lastHandledManualStopAt == 0L && (now - reqStopAt) > 4_000L) {
                            lastHandledManualStopAt = reqStopAt;
                        } else {
                            lastHandledManualStopAt = reqStopAt;
                            runOnUiThread(() -> stopManualAnalysisCapture(false));
                        }
                    }
                } catch (Exception ignored) {}
            }
            String incomingPairingCode = obj.optString("pairingCode", rootObj.optString("pairingCode", "")).trim();
            if (incomingPairingCode.matches("^[1-9][0-9]{5}$")
                    && (!hasPairingCode || !incomingPairingCode.equals(pairingCode))) {
                pairingCode = incomingPairingCode;
                hasPairingCode = true;
                parsePairingDigitsFromString(incomingPairingCode);
                lastCloudHeartbeatTouchMs = 0L;
                saveState();
                pollFirestoreCloud();
            }
            if (obj.has("analysisMode") || obj.has("practiceType")) {
                boolean nextAnalysis = obj.optBoolean("analysisMode", "Análisis".equals(obj.optString("practiceType", "")));
                if (nextAnalysis != analysisMode) {
                    analysisMode = nextAnalysis;
                    if (!analysisMode) {
                        manualAnalysisRecording = false;
                        manualAnalysisStartMs = 0L;
                        heartbeatHandler.removeCallbacks(manualTimerRunnable);
                    }
                    syncShotDetectionSensors();
                    runOnUiThread(this::syncBackNavigationCallback);
                }
            }
            if (incomingArrows == 0) {
                lastAnalysisShotNum = 0;
                lastPrepX = new float[0];
                lastPrepY = new float[0];
                lastAimX = new float[0];
                lastAimY = new float[0];
            }
            if (obj.has("bowPoundageLbs")) {
                drawWeightLbs = (float) obj.optDouble("bowPoundageLbs", drawWeightLbs);
            }
            if (obj.has("autoDetectEnabled") && !hasUnackedLocalAction) {
                analysisAutoMode = analysisMode && obj.optBoolean("autoDetectEnabled", false);
                autoDetectEnabled = false;
                syncShotDetectionSensors();
            }
            saveState();
            runOnUiThread(() -> {
                if (shouldRescheduleFromPhone) scheduleNextHeartbeat();
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
            String dataItemCommandJson = jsonPayload;
            long now = System.currentTimeMillis();
            int rawDelta = 0;
            boolean isArrowDeltaCmd = false;
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
                    if ("INCREMENT_ARROW".equals(cmdType) || "DECREMENT_ARROW".equals(cmdType)) {
                        isArrowDeltaCmd = true;
                        rawDelta = obj.optInt("delta", "DECREMENT_ARROW".equals(cmdType) ? -1 : 1);
                        obj.put("targetArrowsCount", arrowCount);
                    }
                    enrichedPayload = obj.toString();
                    if (isArrowDeltaCmd) {
                        JSONObject dataObj = new JSONObject(enrichedPayload);
                        int coalescedDelta = (mPendingUnackedDelta != 0) ? mPendingUnackedDelta : rawDelta;
                        dataObj.put("delta", coalescedDelta);
                        dataObj.put("targetArrowsCount", arrowCount);
                        dataItemCommandJson = dataObj.toString();
                    } else {
                        dataItemCommandJson = enrichedPayload;
                    }
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
                long nonceTs;
                synchronized (this) {
                    nonceTs = Math.max(now, mLastDataItemNonceMs + 1L);
                    mLastDataItemNonceMs = nonceTs;
                }
                PutDataMapRequest putReq = PutDataMapRequest.create("/archery101010/watch_command");
                putReq.getDataMap().putString("command_json", dataItemCommandJson != null ? dataItemCommandJson : enrichedPayload);
                if (isArrowDeltaCmd) {
                    int delta = rawDelta;
                    putReq.getDataMap().putInt("delta", mPendingUnackedDelta != 0 ? mPendingUnackedDelta : delta);
                    putReq.getDataMap().putInt("targetArrowsCount", arrowCount);
                }
                putReq.getDataMap().putLong("sent_at", nonceTs);
                putReq.getDataMap().putLong("nonce", nonceTs);
                Wearable.getDataClient(this).putDataItem(putReq.asPutDataRequest().setUrgent());
                if (hasPairingCode && pairingCode.length() == 6) {
                    syncCommandWithFirestoreCloud(dataItemCommandJson != null ? dataItemCommandJson : enrichedPayload);
                }
            }
        } catch (Exception ignored) {}
    }

    private void parsePairingDigitsFromString(String codeStr) {
        if (codeStr == null || codeStr.length() != 6) return;
        for (int i = 0; i < 6; i++) {
            int d = codeStr.charAt(i) - '0';
            if (d < 0 || d > 9) d = (i == 0) ? 1 : 0;
            if (i == 0 && d == 0) d = 1;
            pairingDigits[i] = d;
        }
    }

    private void adjustSelectedCodeDigit(int delta) {
        int cur = pairingDigits[editDigitPos];
        if (editDigitPos == 0) {
            int nextFirst = cur + delta;
            if (nextFirst > 9) nextFirst = 1;
            if (nextFirst < 1) nextFirst = 9;
            pairingDigits[0] = nextFirst;
        } else {
            pairingDigits[editDigitPos] = (cur + delta + 10) % 10;
        }
        isEditingCode = true;
        markUserActivity(true);
        triggerHaptic(20);
        if (canvasView != null) canvasView.invalidate();
    }

    private void commitPairingDigits() {
        StringBuilder sb = new StringBuilder(6);
        for (int i = 0; i < 6; i++) {
            sb.append(pairingDigits[i]);
        }
        pairingCode = sb.toString();
        hasPairingCode = true;
        isEditingCode = false;
        isCloudSynced = false;
        cloudLinkStatus = "LINKING";
        lastRemoteCloudSig = "";
        lastCloudHeartbeatTouchMs = 0L;
        markUserActivity(true);
        saveState();
        triggerHaptic(45);
        pollFirestoreCloud();
        if (canvasView != null) canvasView.invalidate();
    }

    private void syncCommandWithFirestoreCloud(final String commandJson) {
        if (!hasPairingCode || pairingCode.length() != 6 || commandJson == null) return;
        final String code = pairingCode;
        final int curSteps = stepsCount;
        final int curWalkM = Math.round(getEffectiveWalkedMeters());
        final int curKcal = getActiveKcal();
        final int curScore = totalScore;
        final boolean curAuto = autoDetectEnabled;
        final int curSens = sensitivityLevel;

        cloudExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject src = new JSONObject(commandJson);
                String eventType = src.optString("type", "");
                if (eventType.isEmpty() || "REQUEST_STATE".equals(eventType)) return;
                long nowMs = System.currentTimeMillis();
                long seq = src.optLong("_cmdSeq", nowMs % 100000L);
                String origCmdId = src.optString("_cmdId", "");
                String cmdId = !origCmdId.isEmpty() ? origCmdId : ("wear-" + nowMs + "-" + seq);

                JSONObject cmdFields = new JSONObject();
                cmdFields.put("type", new JSONObject().put("stringValue", eventType));
                cmdFields.put("cmdId", new JSONObject().put("stringValue", cmdId));
                cmdFields.put("_cmdId", new JSONObject().put("stringValue", cmdId));
                cmdFields.put("_ts", new JSONObject().put("integerValue", String.valueOf(nowMs)));

                if ("INCREMENT_ARROW".equals(eventType)) {
                    int cldDelta = Math.max(-20, Math.min(20, src.optInt("delta", 1)));
                    cmdFields.put("delta", new JSONObject().put("integerValue", String.valueOf(cldDelta)));
                    cmdFields.put("source", new JSONObject().put("stringValue", src.optString("source", "watch_manual")));
                } else if ("DECREMENT_ARROW".equals(eventType)) {
                    int cldDelta = Math.max(-20, Math.min(20, src.optInt("delta", -1)));
                    cmdFields.put("delta", new JSONObject().put("integerValue", String.valueOf(cldDelta)));
                    cmdFields.put("source", new JSONObject().put("stringValue", "watch_manual"));
                    cmdFields.put("totalScore", new JSONObject().put("integerValue", String.valueOf(curScore)));
                } else if ("SCORE_INPUT".equals(eventType)) {
                    JSONObject pay = src.optJSONObject("payload");
                    String val = pay != null ? pay.optString("value", src.optString("value", "")) : src.optString("value", "");
                    cmdFields.put("value", new JSONObject().put("stringValue", val));
                    cmdFields.put("totalScore", new JSONObject().put("integerValue", String.valueOf(curScore)));
                } else if ("UNDO_ARROW".equals(eventType)) {
                    cmdFields.put("totalScore", new JSONObject().put("integerValue", String.valueOf(curScore)));
                } else if ("TOGGLE_AUTO_DETECT".equals(eventType)) {
                    cmdFields.put("enabled", new JSONObject().put("booleanValue", curAuto));
                    cmdFields.put("sensitivityLevel", new JSONObject().put("integerValue", String.valueOf(curSens)));
                } else if ("SYNC_TELEMETRY_FROM_WATCH".equals(eventType)) {
                    cmdFields.put("stepsCount", new JSONObject().put("integerValue", String.valueOf(curSteps)));
                    cmdFields.put("distanceWalkedM", new JSONObject().put("integerValue", String.valueOf(curWalkM)));
                    cmdFields.put("activeKcal", new JSONObject().put("integerValue", String.valueOf(curKcal)));
                    int syncHr = isLocalHeartRateFresh() ? localSensorHrBpm : 0;
                    if (syncHr >= 30 && syncHr <= 245) {
                        cmdFields.put("heartRateBpm", new JSONObject().put("integerValue", String.valueOf(syncHr)));
                    }
                    if (localAvgHrBpm >= 30 && localAvgHrBpm <= 245) {
                        cmdFields.put("avgHeartRateBpm", new JSONObject().put("integerValue", String.valueOf(localAvgHrBpm)));
                    }
                    if (localMaxHrBpm >= 30 && localMaxHrBpm <= 245) {
                        cmdFields.put("maxHeartRateBpm", new JSONObject().put("integerValue", String.valueOf(localMaxHrBpm)));
                    }
                } else if ("ANALYSIS_MANUAL_START".equals(eventType) || "ANALYSIS_MANUAL_STOP".equals(eventType)) {
                    long cmdTs = src.optLong("ts", nowMs);
                    cmdFields.put("ts", new JSONObject().put("integerValue", String.valueOf(cmdTs)));
                    cmdFields.put("source", new JSONObject().put("stringValue", src.optString("source", "watch_manual")));
                } else if ("ANALYSIS_SHOT".equals(eventType) || "ANALYSIS_ZERO_VECTOR".equals(eventType)) {
                    String shotJson = src.optString("analysisShotJson", "");
                    if (!shotJson.isEmpty()) {
                        cmdFields.put("analysisShotJson", new JSONObject().put("stringValue", shotJson));
                    }
                    int shotHr = src.optInt("heartRateBpm", 0);
                    if (shotHr >= 30 && shotHr <= 245) {
                        cmdFields.put("heartRateBpm", new JSONObject().put("integerValue", String.valueOf(shotHr)));
                    }
                }

                lastCloudHeartbeatTouchMs = nowMs;
                JSONObject docFields = new JSONObject();
                docFields.put("lastWatchCmd", new JSONObject().put("mapValue", new JSONObject().put("fields", cmdFields)));
                docFields.put("lastWatchCmdId", new JSONObject().put("stringValue", cmdId));
                docFields.put("lastWatchCmdSeq", new JSONObject().put("integerValue", String.valueOf(seq)));
                docFields.put("watchStepsCount", new JSONObject().put("integerValue", String.valueOf(curSteps)));
                docFields.put("watchDistanceM", new JSONObject().put("integerValue", String.valueOf(curWalkM)));
                docFields.put("watchSource", new JSONObject().put("stringValue", "WEAR_OS"));
                docFields.put("watchHeartbeatAt", new JSONObject().put("integerValue", String.valueOf(nowMs)));
                docFields.put("updatedAt", new JSONObject().put("integerValue", String.valueOf(nowMs)));

                StringBuilder mask = new StringBuilder();
                mask.append("updateMask.fieldPaths=lastWatchCmd")
                    .append("&updateMask.fieldPaths=lastWatchCmdId")
                    .append("&updateMask.fieldPaths=lastWatchCmdSeq")
                    .append("&updateMask.fieldPaths=watchStepsCount")
                    .append("&updateMask.fieldPaths=watchDistanceM")
                    .append("&updateMask.fieldPaths=watchSource")
                    .append("&updateMask.fieldPaths=watchHeartbeatAt")
                    .append("&updateMask.fieldPaths=updatedAt");

                int hrLive = isLocalHeartRateFresh() ? localSensorHrBpm : 0;
                int hrAvg = localAvgHrBpm;
                int hrMax = localMaxHrBpm;
                if (hrLive >= 30 && hrLive <= 245) {
                    docFields.put("watchHeartRateBpm", new JSONObject().put("integerValue", String.valueOf(hrLive)));
                    mask.append("&updateMask.fieldPaths=watchHeartRateBpm");
                }
                if (hrAvg >= 30 && hrAvg <= 245) {
                    docFields.put("watchAvgHeartRateBpm", new JSONObject().put("integerValue", String.valueOf(hrAvg)));
                    mask.append("&updateMask.fieldPaths=watchAvgHeartRateBpm");
                }
                if (hrMax >= 30 && hrMax <= 245) {
                    docFields.put("watchMaxHeartRateBpm", new JSONObject().put("integerValue", String.valueOf(hrMax)));
                    mask.append("&updateMask.fieldPaths=watchMaxHeartRateBpm");
                }

                String urlStr = "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/"
                        + code
                        + "?" + mask + "&currentDocument.exists=true";
                conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("X-HTTP-Method-Override", "PATCH");
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                conn.setDoOutput(true);

                byte[] body = new JSONObject().put("fields", docFields).toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }
                int rc = conn.getResponseCode();
                boolean ok = rc >= 200 && rc < 300;
                if (ok) {
                    isCloudSynced = true;
                    cloudLinkStatus = "SYNCED";
                } else if (rc == 404 || rc == 401 || rc == 403) {
                    isCloudSynced = false;
                    cloudLinkStatus = "NOT_FOUND";
                }
                runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
            } catch (Exception ignored) {
                if ("LINKING".equals(cloudLinkStatus)) {
                    cloudLinkStatus = "NO_NET";
                    runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private int extractFsInt(JSONObject fields, String key, int fallback) {
        if (fields == null || !fields.has(key)) return fallback;
        JSONObject node = fields.optJSONObject(key);
        if (node == null) return fallback;
        if (node.has("integerValue")) {
            try { return Integer.parseInt(node.optString("integerValue", String.valueOf(fallback))); } catch (Exception ignored) {}
        }
        if (node.has("doubleValue")) {
            return (int) Math.round(node.optDouble("doubleValue", fallback));
        }
        return fallback;
    }

    private void pollFirestoreCloud() {
        if (!hasPairingCode || pairingCode.length() != 6) return;
        lastCloudPollMs = System.currentTimeMillis();
        final String code = pairingCode;
        cloudExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                String urlStr = "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/" + code;
                conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                int rc = conn.getResponseCode();
                if (rc == 200) {
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line);
                    }
                    JSONObject doc = new JSONObject(sb.toString());
                    JSONObject fields = doc.optJSONObject("fields");
                    if (fields != null) {
                        isCloudSynced = true;
                        cloudLinkStatus = "SYNCED";
                        long now = System.currentTimeMillis();
                        if (lastCloudHeartbeatTouchMs == 0L || (now - lastCloudHeartbeatTouchMs) >= 35_000L) {
                            lastCloudHeartbeatTouchMs = now;
                            touchWatchHeartbeatInFirestore(code, now);
                        }
                        long cloudProtectWindowMs = (mPendingUnackedDelta != 0) ? 20000L : 3500L;
                        boolean recentlyTapped = (now - lastLocalActionTimeMs) < cloudProtectWindowMs;
                        JSONObject activeNode = fields.optJSONObject("sessionActive");
                        boolean sessionActive = activeNode == null || activeNode.optBoolean("booleanValue", true);
                        JSONObject sidNode = fields.optJSONObject("sessionId");
                        String incomingSid = sidNode != null ? sidNode.optString("stringValue", "") : "";

                        final int fsArrows = extractFsInt(fields, "arrowsCount", arrowCount);
                        if (fields.has("arrowsCount") && fsArrows == arrowCount) {
                            mPendingUnackedDelta = 0;
                        }
                        final int fsScore = extractFsInt(fields, "totalScore", totalScore);
                        final int fsEnd = Math.max(1, extractFsInt(fields, "currentEnd", currentEnd));
                        final int fsDistM = extractFsInt(fields, "distanceM", distanceMeters);
                        final int fsPerEnd = Math.max(1, extractFsInt(fields, "arrowsPerEnd", syncedArrowsPerEnd));
                        final int fsEnds = Math.max(1, extractFsInt(fields, "totalEnds", syncedEndsCount));
                        JSONObject autoNode = fields.optJSONObject("autoDetectEnabled");
                        final boolean fsAuto = autoNode != null ? autoNode.optBoolean("booleanValue", autoDetectEnabled) : autoDetectEnabled;
                        final int fsSens = Math.max(0, Math.min(2, extractFsInt(fields, "sensitivityLevel", sensitivityLevel)));
                        JSONObject amNode = fields.optJSONObject("analysisMode");
                        JSONObject ptNode = fields.optJSONObject("practiceType");
                        final boolean fsAnalysis = amNode != null
                                ? amNode.optBoolean("booleanValue", false)
                                : (ptNode != null && "Análisis".equals(ptNode.optString("stringValue", "")));
                        JSONObject btNode = fields.optJSONObject("bowType");
                        final String fsBowType = btNode != null ? btNode.optString("stringValue", syncedBowType) : syncedBowType;
                        final int fsHr = extractFsInt(fields, "watchHeartRateBpm", extractFsInt(fields, "heartRateBpm", 0));
                        JSONObject calNode = fields.optJSONObject("analysisCalibrationJson");
                        final String fsCalJson = calNode != null ? calNode.optString("stringValue", "") : "";

                        JSONObject arrField = fields.optJSONObject("currentEndArrows");
                        final JSONObject arrVal = arrField != null ? arrField.optJSONObject("arrayValue") : null;
                        final JSONArray vals = arrVal != null ? arrVal.optJSONArray("values") : null;
                        StringBuilder endArrowsSb = new StringBuilder();
                        if (vals != null) {
                            for (int i = 0; i < vals.length(); i++) {
                                JSONObject item = vals.optJSONObject(i);
                                if (item != null && item.has("stringValue")) {
                                    if (endArrowsSb.length() > 0) endArrowsSb.append(',');
                                    endArrowsSb.append(item.optString("stringValue", ""));
                                }
                            }
                        }

                        // Detect genuine remote cloud state changes to wake Active Tier cadence
                        String nextCloudSig = (sessionActive ? "1|" : "0|") + incomingSid + "|"
                                + fsArrows + "|" + fsScore + "|" + fsEnd + "|" + endArrowsSb + "|"
                                + fsDistM + "|" + fsPerEnd + "|" + fsEnds + "|"
                                + (fsAuto ? "1|" : "0|") + fsSens + "|"
                                + (fsAnalysis ? "1|" : "0|") + fsCalJson;
                        boolean cloudStateChanged = false;
                        if (lastRemoteCloudSig.isEmpty()) {
                            lastRemoteCloudSig = nextCloudSig;
                        } else if (!nextCloudSig.equals(lastRemoteCloudSig)) {
                            lastRemoteCloudSig = nextCloudSig;
                            lastActivityMs = now;
                            cloudStateChanged = true;
                        }
                        final boolean shouldRescheduleFromCloud = cloudStateChanged;

                        runOnUiThread(() -> {
                            if (shouldRescheduleFromCloud) {
                                scheduleNextHeartbeat();
                            }
                            if (!fsCalJson.isEmpty()) {
                                try {
                                    JSONObject cal = new JSONObject(fsCalJson);
                                    String bw = cal.optString("bowWrist", syncedBowWrist);
                                    if ("LEFT".equals(bw) || "RIGHT".equals(bw)) syncedBowWrist = bw;
                                    long reqStartAt = cal.optLong("manualStartAt", 0L);
                                    long reqStopAt = cal.optLong("manualStopAt", 0L);
                                    if (reqStartAt > 0L
                                            && reqStartAt != lastHandledManualStartAt
                                            && (now - reqStartAt) <= 25_000L
                                            && reqStopAt < reqStartAt) {
                                        lastHandledManualStartAt = reqStartAt;
                                        startManualAnalysisCapture(false);
                                    }
                                    if (reqStopAt > 0L
                                            && reqStopAt != lastHandledManualStopAt
                                            && (now - reqStopAt) <= 15_000L) {
                                        if (lastHandledManualStopAt == 0L && (now - reqStopAt) > 4_000L) {
                                            lastHandledManualStopAt = reqStopAt;
                                        } else {
                                            lastHandledManualStopAt = reqStopAt;
                                            stopManualAnalysisCapture(false);
                                        }
                                    }
                                    long reqManualAt = cal.optLong("manualCaptureAt", 0L);
                                    if (reqManualAt > 0L
                                            && reqManualAt != lastHandledManualCaptureAt
                                            && (now - reqManualAt) <= 15_000L) {
                                        if (lastHandledManualCaptureAt == 0L && (now - reqManualAt) > 4_000L) {
                                            lastHandledManualCaptureAt = reqManualAt;
                                        } else {
                                            lastHandledManualCaptureAt = reqManualAt;
                                            if (manualAnalysisRecording) {
                                                stopManualAnalysisCapture(false);
                                            } else {
                                                emitWearAnalysisShot(0L, System.currentTimeMillis(), "watch_manual");
                                            }
                                        }
                                    }
                                    long reqZeroAt = cal.optLong("calibrateZeroAt", 0L);
                                    if (reqZeroAt > 0L
                                            && reqZeroAt != lastHandledCalibrateZeroAt
                                            && (now - reqZeroAt) <= 15_000L) {
                                        if (lastHandledCalibrateZeroAt == 0L && (now - reqZeroAt) > 4_000L) {
                                            lastHandledCalibrateZeroAt = reqZeroAt;
                                        } else {
                                            lastHandledCalibrateZeroAt = reqZeroAt;
                                            heartbeatHandler.postDelayed(this::captureWearZeroGravityVector, 1800L);
                                        }
                                    }
                                    JSONArray zArr = cal.optJSONArray("zeroGravityVec");
                                    if (zArr != null && zArr.length() == 3) {
                                        double zx = zArr.optDouble(0, 0.0);
                                        double zy = zArr.optDouble(1, 0.0);
                                        double zz = zArr.optDouble(2, 9.81);
                                        if (Math.abs(zx) > 0.01 || Math.abs(zy) > 0.01) {
                                            calZeroAx = zx;
                                            calZeroAy = zy;
                                            calZeroAz = zz;
                                            hasCalZeroVec = true;
                                        }
                                    }
                                } catch (Exception ignored) {}
                            }
                            if (!sessionActive) {
                                if (analysisMode) {
                                    analysisMode = false;
                                    syncShotDetectionSensors();
                                }
                                if (!recentlyTapped && (arrowCount > 0 || totalScore > 0 || stepsCount > 0 || lastAnalysisShotNum > 0)) {
                                    resetWatchSessionCounters(true);
                                }
                                if (canvasView != null) canvasView.invalidate();
                                return;
                            }
                            if (!incomingSid.isEmpty() && !currentSessionId.isEmpty() && !incomingSid.equals(currentSessionId)) {
                                resetWatchSessionCounters(false);
                                currentSessionId = incomingSid;
                            } else if (!incomingSid.isEmpty()) {
                                currentSessionId = incomingSid;
                            }
                            if (!recentlyTapped) {
                                arrowCount = fsArrows;
                                mPendingUnackedDelta = 0;
                                totalScore = fsScore;
                                currentEnd = fsEnd;
                                if (arrVal != null) {
                                    currentEndArrows.clear();
                                    if (vals != null) {
                                        for (int i = 0; i < vals.length(); i++) {
                                            JSONObject item = vals.optJSONObject(i);
                                            if (item != null && item.has("stringValue")) {
                                                currentEndArrows.add(item.optString("stringValue", ""));
                                            }
                                        }
                                    }
                                }
                                if (autoNode != null) {
                                    analysisAutoMode = fsAnalysis && fsAuto;
                                    autoDetectEnabled = false;
                                    syncShotDetectionSensors();
                                }
                                sensitivityLevel = fsSens;
                            }
                            distanceMeters = fsDistM;
                            syncedArrowsPerEnd = fsPerEnd;
                            syncedEndsCount = fsEnds;
                            if (!fsBowType.isEmpty()) syncedBowType = fsBowType;
                            if (fsHr >= 30 && fsHr <= 245 && !isLocalHeartRateFresh()) syncedHeartRateBpm = fsHr;
                            if (fsAnalysis != analysisMode) {
                                analysisMode = fsAnalysis;
                                analysisAutoMode = fsAnalysis && fsAuto;
                                if (!analysisMode) {
                                    manualAnalysisRecording = false;
                                    manualAnalysisStartMs = 0L;
                                    heartbeatHandler.removeCallbacks(manualTimerRunnable);
                                }
                                syncShotDetectionSensors();
                                syncBackNavigationCallback();
                            }
                            if (fsArrows == 0) {
                                lastAnalysisShotNum = 0;
                                lastPrepX = new float[0];
                                lastPrepY = new float[0];
                                lastAimX = new float[0];
                                lastAimY = new float[0];
                            }
                            drawWeightLbs = Math.max(12f, (float) extractFsInt(fields, "bowPoundageLbs", Math.round(drawWeightLbs)));
                            int cloudWalk = extractFsInt(fields, "distanceWalkedM", 0);
                            if (cloudWalk > distanceWalkedM) distanceWalkedM = cloudWalk;
                            int cloudKcal = extractFsInt(fields, "caloriesBurnedKcal", -1);
                            if (cloudKcal > syncedActiveKcal) syncedActiveKcal = cloudKcal;
                            saveState();
                            if (canvasView != null) canvasView.invalidate();
                        });
                    }
                } else if (rc == 404 || rc == 401 || rc == 403) {
                    isCloudSynced = false;
                    cloudLinkStatus = "NOT_FOUND";
                    runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
                } else {
                    isCloudSynced = false;
                    cloudLinkStatus = "NO_NET";
                    runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
                }
            } catch (Exception ignored) {
                isCloudSynced = false;
                cloudLinkStatus = "NO_NET";
                runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void touchWatchHeartbeatInFirestore(final String code, final long nowMs) {
        if (code == null || code.length() != 6) return;
        cloudExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject docFields = new JSONObject();
                docFields.put("watchSource", new JSONObject().put("stringValue", "WEAR_OS"));
                docFields.put("watchHeartbeatAt", new JSONObject().put("integerValue", String.valueOf(nowMs)));
                docFields.put("updatedAt", new JSONObject().put("integerValue", String.valueOf(nowMs)));

                StringBuilder mask = new StringBuilder();
                mask.append("updateMask.fieldPaths=watchSource")
                    .append("&updateMask.fieldPaths=watchHeartbeatAt")
                    .append("&updateMask.fieldPaths=updatedAt");

                int hrLive = isLocalHeartRateFresh() ? localSensorHrBpm : 0;
                int hrAvg = localAvgHrBpm;
                int hrMax = localMaxHrBpm;
                if (hrLive >= 30 && hrLive <= 245) {
                    docFields.put("watchHeartRateBpm", new JSONObject().put("integerValue", String.valueOf(hrLive)));
                    mask.append("&updateMask.fieldPaths=watchHeartRateBpm");
                }
                if (hrAvg >= 30 && hrAvg <= 245) {
                    docFields.put("watchAvgHeartRateBpm", new JSONObject().put("integerValue", String.valueOf(hrAvg)));
                    mask.append("&updateMask.fieldPaths=watchAvgHeartRateBpm");
                }
                if (hrMax >= 30 && hrMax <= 245) {
                    docFields.put("watchMaxHeartRateBpm", new JSONObject().put("integerValue", String.valueOf(hrMax)));
                    mask.append("&updateMask.fieldPaths=watchMaxHeartRateBpm");
                }

                String urlStr = "https://firestore.googleapis.com/v1/projects/archery101010-c0bb4/databases/(default)/documents/watch_sessions/"
                        + code
                        + "?" + mask + "&currentDocument.exists=true";
                conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("X-HTTP-Method-Override", "PATCH");
                conn.setConnectTimeout(5500);
                conn.setReadTimeout(5500);
                conn.setDoOutput(true);
                byte[] body = new JSONObject().put("fields", docFields).toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }
                int rc = conn.getResponseCode();
                if (rc >= 200 && rc < 300) {
                    isCloudSynced = true;
                    cloudLinkStatus = "SYNCED";
                } else if (rc == 404 || rc == 401 || rc == 403) {
                    isCloudSynced = false;
                    cloudLinkStatus = "NOT_FOUND";
                }
                runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
            } catch (Exception ignored) {
                if ("LINKING".equals(cloudLinkStatus)) {
                    cloudLinkStatus = "NO_NET";
                    runOnUiThread(() -> { if (canvasView != null) canvasView.invalidate(); });
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void captureWearZeroGravityVector() {
        try {
            if (motionCount < 4) return;
            int n = Math.min(24, motionCount);
            double sx = 0.0, sy = 0.0, sz = 0.0;
            for (int i = 0; i < n; i++) {
                int idx = (motionIdx - 1 - i + MOTION_BUF) % MOTION_BUF;
                sx += motionAx[idx];
                sy += motionAy[idx];
                sz += motionAz[idx];
            }
            calZeroAx = Math.round((sx / n) * 1000.0) / 1000.0;
            calZeroAy = Math.round((sy / n) * 1000.0) / 1000.0;
            calZeroAz = Math.round((sz / n) * 1000.0) / 1000.0;
            hasCalZeroVec = true;
            triggerHaptic(35);
            JSONArray vec = new JSONArray();
            vec.put(calZeroAx);
            vec.put(calZeroAy);
            vec.put(calZeroAz);
            JSONObject cmd = new JSONObject();
            cmd.put("type", "ANALYSIS_ZERO_VECTOR");
            cmd.put("analysisShotJson", vec.toString());
            sendToPhone(cmd.toString());
        } catch (Exception ignored) {}
    }

    private void syncTelemetryToPhone() {
        try {
            lastSyncedStepsCount = stepsCount;
            lastTelemetrySyncTimeMs = System.currentTimeMillis();
            int syncHr = isLocalHeartRateFresh() ? localSensorHrBpm : 0;
            JSONObject payload = new JSONObject();
            payload.put("stepsCount", stepsCount);
            payload.put("distanceWalkedM", Math.round(getEffectiveWalkedMeters()));
            payload.put("activeKcal", getActiveKcal());
            if (syncHr >= 30 && syncHr <= 245) {
                payload.put("heartRateBpm", syncHr);
            }
            if (localAvgHrBpm >= 30 && localAvgHrBpm <= 245) {
                payload.put("avgHeartRateBpm", localAvgHrBpm);
            }
            if (localMaxHrBpm >= 30 && localMaxHrBpm <= 245) {
                payload.put("maxHeartRateBpm", localMaxHrBpm);
            }

            JSONObject cmd = new JSONObject();
            cmd.put("type", "SYNC_TELEMETRY_FROM_WATCH");
            cmd.put("payload", payload);
            cmd.put("stepsCount", stepsCount);
            cmd.put("distanceWalkedM", Math.round(getEffectiveWalkedMeters()));
            if (syncHr >= 30 && syncHr <= 245) {
                cmd.put("heartRateBpm", syncHr);
            }
            if (localAvgHrBpm >= 30 && localAvgHrBpm <= 245) {
                cmd.put("avgHeartRateBpm", localAvgHrBpm);
            }
            if (localMaxHrBpm >= 30 && localMaxHrBpm <= 245) {
                cmd.put("maxHeartRateBpm", localMaxHrBpm);
            }
            sendToPhone(cmd.toString());
        } catch (Exception ignored) {}
    }

    @Override
    protected void onResume() {
        super.onResume();
        activeInstanceRef = new WeakReference<>(this);
        if (wakeLock != null && !wakeLock.isHeld()) {
            try {
                wakeLock.acquire(4 * 60 * 60 * 1000L);
            } catch (Exception ignored) {}
        }
        if (canvasView != null) {
            canvasView.requestFocus();
        }
        syncBackNavigationCallback();
        markUserActivity(false);
        ensureSensorAndHeartbeatActive();
        if (hasHeartRatePermission()) {
            startHeartRateStreaming(false, false);
        } else if (!hrPermissionRequestedThisRun && !hrPermissionPromptInFlight) {
            startHeartRateStreaming(true, false);
        }
        sendToPhone("{\"type\":\"REQUEST_STATE\"}");
    }

    @Override
    protected void onPause() {
        super.onPause();
        saveState();
        boolean idleNoSession = !analysisMode
                && arrowCount == 0
                && lastAnalysisShotNum == 0
                && totalScore == 0
                && currentSessionId.isEmpty();
        if (idleNoSession) {
            heartbeatHandler.removeCallbacks(heartbeatRunnable);
            stopAcousticSnapAnalyzer();
            stopHeartRateStreaming();
            if (sensorManager != null && isSensorRegistered) {
                try {
                    sensorManager.unregisterListener(this);
                    isSensorRegistered = false;
                } catch (Exception ignored) {}
            }
            if (wakeLock != null && wakeLock.isHeld()) {
                try {
                    wakeLock.release();
                } catch (Exception ignored) {}
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && isBackCallbackRegistered && wearBackInvokedCallback != null) {
            try {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(
                        (android.window.OnBackInvokedCallback) wearBackInvokedCallback
                );
            } catch (Throwable ignored) {}
            isBackCallbackRegistered = false;
        }
        if (activeInstanceRef != null && activeInstanceRef.get() == this) {
            activeInstanceRef = new WeakReference<>(null);
        }
        heartbeatHandler.removeCallbacks(heartbeatRunnable);
        stopAcousticSnapAnalyzer();
        stopHeartRateStreaming();
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
        try {
            cloudExecutor.shutdownNow();
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    private void resetWatchSessionCounters(boolean clearSessionId) {
        arrowCount = 0;
        mPendingUnackedDelta = 0;
        syncedArrowsCount = 0;
        totalScoredArrows = 0;
        totalScore = 0;
        currentEnd = 1;
        currentEndArrows.clear();
        stepsCount = 0;
        lastSyncedStepsCount = 0;
        distanceWalkedM = 0f;
        syncedWalkedMeters = 0f;
        syncedActiveKcal = -1;
        accelCandidateStepCount = 0;
        accelRhythmicCadenceActive = false;
        pendingShotActive = false;
        manualAnalysisRecording = false;
        manualAnalysisStartMs = 0L;
        heartbeatHandler.removeCallbacks(manualTimerRunnable);
        recentStepBoutCount = 0;
        localHrSumBpm = 0L;
        localHrSampleCount = 0;
        localAvgHrBpm = 0;
        localMaxHrBpm = 0;
        lastAnalysisShotNum = 0;
        lastPrepX = new float[0];
        lastPrepY = new float[0];
        lastAimX = new float[0];
        lastAimY = new float[0];
        if (clearSessionId) {
            currentSessionId = "";
            if (analysisMode) {
                analysisMode = false;
                syncShotDetectionSensors();
            }
        }
        SharedPreferences.Editor editor = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        editor.putString("currentSessionId", currentSessionId);
        editor.putInt("arrowCount", 0);
        editor.putInt("totalScore", 0);
        editor.putInt("totalScoredArrows", 0);
        editor.putInt("currentEnd", 1);
        editor.putInt("stepsCount", 0);
        editor.putFloat("walkedMeters", 0f);
        editor.putInt("pendingUnackedDelta", 0);
        editor.apply();
    }

    private void saveState() {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        editor.putString("currentSessionId", currentSessionId);
        if (hasPairingCode && pairingCode.length() == 6) {
            editor.putString("pairingCode", pairingCode);
        }
        editor.putInt("arrowCount", arrowCount);
        editor.putInt("totalScore", totalScore);
        editor.putInt("totalScoredArrows", totalScoredArrows);
        editor.putInt("currentEnd", currentEnd);
        editor.putInt("stepsCount", stepsCount);
        editor.putFloat("walkedMeters", getEffectiveWalkedMeters());
        editor.putInt("syncedArrowsPerEnd", syncedArrowsPerEnd);
        editor.putInt("syncedEndsCount", syncedEndsCount);
        editor.putBoolean("autoDetectEnabled_v2", autoDetectEnabled);
        editor.putInt("sensitivityLevel", sensitivityLevel);
        editor.putLong("cmdSequence", cmdSequence);
        editor.putInt("pendingUnackedDelta", mPendingUnackedDelta);
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

    private boolean isSpanishLocale() {
        boolean isSpanish = Locale.getDefault().getLanguage().toLowerCase().startsWith("es");
        return isSpanish;
    }

    private boolean isImperialUnits() {
        boolean isImperial = "US".equalsIgnoreCase(Locale.getDefault().getCountry())
                || "GB".equalsIgnoreCase(Locale.getDefault().getCountry());
        return isImperial;
    }

    private String tr(String es, String en) {
        return isSpanishLocale() ? es : en;
    }

    private float getEffectiveWalkedMeters() {
        return Math.max(0f, Math.max(distanceWalkedM, stepsCount * 0.78f));
    }

    private int getActiveKcal() {
        int arrowsShot = Math.max(arrowCount, totalScoredArrows);
        float walkedM = getEffectiveWalkedMeters();
        if (arrowsShot <= 0 && walkedM < 10f) {
            return syncedActiveKcal > 0 ? syncedActiveKcal : 0;
        }
        double kcalPerArrow = 0.56 + (Math.max(15, drawWeightLbs) * 0.0165);
        double walkKcal = (walkedM / 1000.0) * 72.0 * 0.78;
        if (syncedActiveKcal >= 0) {
            int localArrowDelta = Math.max(0, arrowsShot - syncedArrowsCount);
            float localWalkDelta = Math.max(0f, walkedM - syncedWalkedMeters);
            int localDeltaKcal = (int) Math.round(
                (localArrowDelta * kcalPerArrow) + ((localWalkDelta / 1000.0) * 72.0 * 0.78)
            );
            return syncedActiveKcal + localDeltaKcal;
        }
        return (int) Math.round((arrowsShot * kcalPerArrow) + walkKcal);
    }

    private String getFormattedWalkedMetric() {
        float walkedM = getEffectiveWalkedMeters();
        if (walkedM >= 1000f) {
            return String.format(Locale.US, "%.2f km", walkedM / 1000.0);
        }
        return Math.max(0, Math.round(walkedM)) + " m";
    }

    private String getFormattedWalkedImperial() {
        float walkedM = getEffectiveWalkedMeters();
        double miles = walkedM / 1609.344;
        if (miles >= 0.1) {
            return String.format(Locale.US, "%.2f mi", miles);
        }
        int ft = Math.max(0, Math.round(walkedM * 3.28084f));
        return ft + " ft";
    }

    private String getFormattedWalkedPrimary() {
        return isImperialUnits() ? getFormattedWalkedImperial() : getFormattedWalkedMetric();
    }

    private String getFormattedKmAndMi() {
        String met = getFormattedWalkedMetric();
        String imp = getFormattedWalkedImperial();
        return isImperialUnits() ? (imp + " · " + met) : (met + " · " + imp);
    }

    private void recordDetectedSteps(long now, int stepDelta) {
        if (stepDelta <= 0) return;
        if ((now - lastStepTimeMs) > 9000L) {
            recentStepBoutCount = 0;
        }
        recentStepBoutCount += stepDelta;
        prevStepTimeMs = lastStepTimeMs;
        lastStepTimeMs = now;
        pendingShotActive = false;

        // Single step locks 4.8s; sustained walk to/from target (4+ steps) locks 9.0s
        long lockDurationMs = (recentStepBoutCount >= 4) ? 9000L : 4800L;
        walkingLockUntilMs = Math.max(walkingLockUntilMs, now + lockDurationMs);
        stepsCount += stepDelta;
        distanceWalkedM = Math.max(distanceWalkedM + (stepDelta * 0.78f), stepsCount * 0.78f);
        saveState();
        if ((now - lastTelemetrySyncTimeMs) >= 1800L) {
            syncTelemetryToPhone();
        }
        if (canvasView != null) canvasView.invalidate();
    }

    /**
     * Zero-permission bipedal wrist step detector: requires rhythmic peak->valley walking cadence (4+ evenly spaced steps)
     * so watch screen taps, isolated bow raises, draws, or releases NEVER increment stepsCount.
     */
    private void evaluateRhythmicAccelStep(long now) {
        long prevCandidate = accelCandidateStepCount > 0
            ? accelCandidateStepT[(accelCandidateStepCount - 1) % 4]
            : 0L;
        long dt = prevCandidate > 0L ? (now - prevCandidate) : 0L;
        if (prevCandidate > 0L && dt < 300L) {
            return;
        }
        if (prevCandidate > 0L && dt > 1250L) {
            double expectedDouble = stepLastMeanIv * 2.0;
            if (accelRhythmicCadenceActive && dt <= 1950L && Math.abs(dt - expectedDouble) <= expectedDouble * 0.34) {
                accelCandidateStepT[accelCandidateStepCount % 4] = prevCandidate + (dt / 2L);
                accelCandidateStepCount++;
                accelCandidateStepT[accelCandidateStepCount % 4] = now;
                accelCandidateStepCount++;
                recordDetectedSteps(now, 2);
                return;
            }
            accelCandidateStepCount = 0;
            accelRhythmicCadenceActive = false;
            accelCandidateStepT[0] = now;
            accelCandidateStepCount = 1;
            return;
        }

        accelCandidateStepT[accelCandidateStepCount % 4] = now;
        accelCandidateStepCount++;

        if (accelRhythmicCadenceActive) {
            if (accelCandidateStepCount >= 2) {
                long prevT = accelCandidateStepT[(accelCandidateStepCount - 2 + 4) % 4];
                stepLastMeanIv = 0.75 * stepLastMeanIv + 0.25 * (now - prevT);
            }
            recordDetectedSteps(now, 1);
            return;
        }

        // Need 4 rhythmic peaks (3 consecutive intervals within [300ms, 1250ms] and ±34% of average)
        if (accelCandidateStepCount >= 4) {
            long t3 = accelCandidateStepT[(accelCandidateStepCount - 1) % 4];
            long t2 = accelCandidateStepT[(accelCandidateStepCount - 2) % 4];
            long t1 = accelCandidateStepT[(accelCandidateStepCount - 3) % 4];
            long t0 = accelCandidateStepT[(accelCandidateStepCount - 4) % 4];
            long g1 = t1 - t0;
            long g2 = t2 - t1;
            long g3 = t3 - t2;
            boolean validRange = g1 >= 300L && g1 <= 1250L && g2 >= 300L && g2 <= 1250L && g3 >= 300L && g3 <= 1250L;
            double avg = (g1 + g2 + g3) / 3.0;
            boolean rhythmic = Math.abs(g1 - avg) <= avg * 0.34
                && Math.abs(g2 - avg) <= avg * 0.34
                && Math.abs(g3 - avg) <= avg * 0.34;
            if (validRange && rhythmic) {
                accelRhythmicCadenceActive = true;
                stepLastMeanIv = avg;
                recordDetectedSteps(now, 4);
            }
        }
    }

    /**
     * 7-Gate Biomechanical Aiming Anchor Verification:
     *  1. Tight isometric linear quietness over [now - windowMs - 45ms, now - 45ms]
     *  2. Final-220ms pre-yank tension guard (rejects force ramp before pulling stuck arrows from foam)
     *  3. 3D Horizontal Forearm Posture (|meanAx| / g <= 0.68 & perpGravity >= 6.8 m/s² — rejects walking arms-down & quiver reach)
     *  4. 3D Per-Axis Stability (max-min <= axisSpanMax — rejects wrist twisting / arrow-puller wrapping)
     *  5. Hardware Gyroscope angular-velocity stillness (mean <= gyroMeanMax, max <= gyroPeakMax)
     */
    private boolean isTrueArcheryAnchor(
            long now,
            long windowMs,
            double quietMeanMax,
            double quietPeakMax,
            double preRampMeanMax,
            double axisSpanMax,
            double gyroMeanMax,
            double gyroPeakMax
    ) {
        long end = now - 45L;
        long start = end - windowMs;
        long recentStart = end - 220L;
        int n = 0;
        int recentN = 0;
        int gyroN = 0;
        long oldest = Long.MAX_VALUE;

        double sumLin = 0.0;
        double recentSumLin = 0.0;
        double sumAx = 0.0, sumAy = 0.0, sumAz = 0.0;
        float minAx = Float.MAX_VALUE, maxAx = -Float.MAX_VALUE;
        float minAy = Float.MAX_VALUE, maxAy = -Float.MAX_VALUE;
        float minAz = Float.MAX_VALUE, maxAz = -Float.MAX_VALUE;
        double sumGyro = 0.0;

        for (int i = 0; i < motionCount; i++) {
            int idx = (motionIdx - 1 - i + MOTION_BUF) % MOTION_BUF;
            long t = motionT[idx];
            if (t < start) break;
            if (t > end) continue;

            double lin = motionLin[idx];
            if (lin > quietPeakMax) return false;

            float gRad = motionGyro[idx];
            if (gRad >= 0f) {
                if (gRad > gyroPeakMax) return false;
                sumGyro += gRad;
                gyroN++;
            }

            float sx = motionAx[idx];
            float sy = motionAy[idx];
            float sz = motionAz[idx];
            sumAx += sx;
            sumAy += sy;
            sumAz += sz;
            if (sx < minAx) minAx = sx;
            if (sx > maxAx) maxAx = sx;
            if (sy < minAy) minAy = sy;
            if (sy > maxAy) maxAy = sy;
            if (sz < minAz) minAz = sz;
            if (sz > maxAz) maxAz = sz;

            sumLin += lin;
            if (t >= recentStart) {
                recentSumLin += lin;
                recentN++;
            }
            n++;
            oldest = t;
        }

        if (n < 16 || oldest == Long.MAX_VALUE || (end - oldest) < (long) (windowMs * 0.85)) {
            return false;
        }
        if ((sumLin / n) > quietMeanMax) {
            return false;
        }
        if (recentN >= 3 && (recentSumLin / recentN) > preRampMeanMax) {
            return false;
        }

        // 3D Forearm Aiming Orientation: bow arm or draw arm is elevated near horizontal, never hanging down
        double meanAx = sumAx / n;
        double meanAy = sumAy / n;
        double meanAz = sumAz / n;
        double gNorm = Math.sqrt(meanAx * meanAx + meanAy * meanAy + meanAz * meanAz);
        if (gNorm < 8.2 || gNorm > 11.4) {
            return false;
        }
        double forearmVerticalRatio = Math.abs(meanAx) / gNorm;
        double perpGravity = Math.sqrt(meanAy * meanAy + meanAz * meanAz);
        // Supports both extended Bow Wrist and anchored Draw/Release Wrist while rejecting arm hanging straight down
        if (forearmVerticalRatio > 0.76 || perpGravity < 6.1) {
            return false;
        }

        // 3D Wrist-Angle Stability: no twisting an arrow puller or rotating wrist toward quiver
        if ((maxAx - minAx) > axisSpanMax
                || (maxAy - minAy) > axisSpanMax
                || (maxAz - minAz) > axisSpanMax) {
            return false;
        }

        // Hardware Gyroscope Rotational Stillness
        if (gyroN >= 8 && (sumGyro / gyroN) > gyroMeanMax) {
            return false;
        }

        return true;
    }

    /** Requires a crisp mechanical shock rise (jump >= minJerk within ~60ms), rejecting slow swings/tugs. */
    private boolean hasSharpReleaseJerk(double currentMag, double minJerk) {
        if (motionCount < 3) return false;
        double maxJump = 0.0;
        for (int k = 1; k <= 3 && k <= motionCount; k++) {
            int prevIdx = (motionIdx - k + MOTION_BUF) % MOTION_BUF;
            double jump = Math.abs(currentMag - motionMag[prevIdx]);
            if (jump > maxJump) {
                maxJump = jump;
            }
        }
        return maxJump >= minJerk;
    }

    /**
     * Sensitive gait & bow-carry movement cadence detector:
     * Detects footsteps even when carrying a heavy stabilized bow (peaks down to 1.05 m/s²)
     * and locks auto-shot detection for 6.0-8.5s without needing ACTIVITY_RECOGNITION permission.
     */
    private void trackMotionPeak(long now, double dynSignal) {
        if (prevDyn >= 1.08 && prevDyn > prevPrevDyn && prevDyn >= dynSignal && (now - lastMotionPeakMs) >= 290L) {
            lastMotionPeakMs = now;
            motionPeakT[motionPeakIdx] = now;
            motionPeakIdx = (motionPeakIdx + 1) % motionPeakT.length;

            long t0 = motionPeakT[(motionPeakIdx - 1 + 8) % 8];
            long t1 = motionPeakT[(motionPeakIdx - 2 + 8) % 8];
            long t2 = motionPeakT[(motionPeakIdx - 3 + 8) % 8];
            long t3 = motionPeakT[(motionPeakIdx - 4 + 8) % 8];

            // 3 consecutive peaks (2 step intervals) -> immediate 6.0s walking lock
            if (t2 > 0 && (now - t2) <= 3000L) {
                long g1 = t0 - t1;
                long g2 = t1 - t2;
                if (g1 >= 290L && g1 <= 1450L && g2 >= 290L && g2 <= 1450L) {
                    double avg2 = (g1 + g2) / 2.0;
                    if (Math.abs(g1 - avg2) <= avg2 * 0.34 && Math.abs(g2 - avg2) <= avg2 * 0.34) {
                        walkingLockUntilMs = Math.max(walkingLockUntilMs, now + 6000L);
                        pendingShotActive = false;
                    }
                }
            }
            // 4 consecutive peaks (3 step intervals) -> 8.5s target-trip lock
            if (t3 > 0 && (now - t3) <= 4400L) {
                long g1 = t0 - t1, g2 = t1 - t2, g3 = t2 - t3;
                boolean inRange = g1 >= 290L && g1 <= 1450L && g2 >= 290L && g2 <= 1450L && g3 >= 290L && g3 <= 1450L;
                double avg3 = (g1 + g2 + g3) / 3.0;
                boolean rhythmic = Math.abs(g1 - avg3) <= avg3 * 0.32
                        && Math.abs(g2 - avg3) <= avg3 * 0.32
                        && Math.abs(g3 - avg3) <= avg3 * 0.32;
                if (inRange && rhythmic) {
                    walkingLockUntilMs = Math.max(walkingLockUntilMs, now + 8500L);
                    pendingShotActive = false;
                }
            }
        }
        prevPrevDyn = prevDyn;
        prevDyn = dynSignal;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        long now = System.currentTimeMillis();
        int sensorType = event.sensor.getType();

        if (sensorType == Sensor.TYPE_GYROSCOPE) {
            float wx = event.values[0];
            float wy = event.values[1];
            float wz = event.values[2];
            latestGyroRadS = (float) Math.sqrt(wx * wx + wy * wy + wz * wz);
            latestGyroY = wy;
            latestGyroZ = wz;
            lastGyroSampleMs = now;
            return;
        }

        if (sensorType == Sensor.TYPE_ACCELEROMETER) {
            float ax = event.values[0];
            float ay = event.values[1];
            float az = event.values[2];
            double mag = Math.sqrt(ax * ax + ay * ay + az * az);
            double dynamicLinear = mag - smoothedAccelMag;
            smoothedAccelMag = 0.96 * smoothedAccelMag + 0.04 * mag;
            double linearMag = Math.abs(mag - SensorManager.GRAVITY_EARTH);
            float activeGyro = ((now - lastGyroSampleMs) <= 140L) ? latestGyroRadS : -1f;

            // Sensitivity: 0 = BAJA (Ultra strict), 1 = MEDIA (Olympic/Compound default), 2 = ALTA (Light bows)
            double shotThreshold = (sensitivityLevel == 0) ? 23.0 : ((sensitivityLevel == 2) ? 15.2 : 18.8);
            double minJerk = (sensitivityLevel == 0) ? 13.5 : ((sensitivityLevel == 2) ? 9.2 : 11.2);
            double quietMeanMax = (sensitivityLevel == 0) ? 0.52 : ((sensitivityLevel == 2) ? 0.80 : 0.65);
            double quietPeakMax = (sensitivityLevel == 0) ? 1.10 : ((sensitivityLevel == 2) ? 1.55 : 1.30);
            double preRampMeanMax = (sensitivityLevel == 0) ? 0.50 : ((sensitivityLevel == 2) ? 0.76 : 0.62);
            double axisSpanMax = (sensitivityLevel == 0) ? 1.55 : ((sensitivityLevel == 2) ? 2.20 : 1.85);
            double gyroMeanMax = (sensitivityLevel == 0) ? 0.25 : ((sensitivityLevel == 2) ? 0.40 : 0.32);
            double gyroPeakMax = (sensitivityLevel == 0) ? 0.65 : ((sensitivityLevel == 2) ? 0.95 : 0.78);
            long stillWindowMs = (sensitivityLevel == 0) ? 1550L : ((sensitivityLevel == 2) ? 1050L : 1300L);
            long shotCooldownMs = (sensitivityLevel == 0) ? 7000L : ((sensitivityLevel == 2) ? 5000L : 6000L);

            trackMotionPeak(now, Math.max(linearMag, Math.abs(dynamicLinear)));

            boolean isWalkingBlocked = now < walkingLockUntilMs;

            // Gate 7: Evaluate 220ms post-release follow-through window exclusively for AUTO Biomechanical Analysis mode
            if (pendingShotActive) {
                if (!analysisMode || !analysisAutoMode || manualAnalysisRecording || isWalkingBlocked) {
                    pendingShotActive = false;
                } else {
                    long elapsed = now - pendingShotStartMs;
                    if (elapsed >= 95L && elapsed <= 235L) {
                        pendingFollowSamples++;
                        pendingFollowSumLin += linearMag;
                        pendingFollowSumAx += ax;
                        if (activeGyro >= 0f) {
                            pendingFollowSumGyro += activeGyro;
                            pendingFollowGyroSamples++;
                        }
                    }
                    if (elapsed >= 220L) {
                        pendingShotActive = false;
                        boolean validFollowThrough = pendingFollowSamples >= 2;
                        if (validFollowThrough) {
                            double followMeanLin = pendingFollowSumLin / pendingFollowSamples;
                            double followMeanAx = Math.abs(pendingFollowSumAx / pendingFollowSamples);
                            double followMeanGyro = pendingFollowGyroSamples >= 2
                                ? (pendingFollowSumGyro / pendingFollowGyroSamples)
                                : 0.0;
                            if (followMeanLin > 7.8 || followMeanAx > 8.0 || followMeanGyro > 4.2) {
                                validFollowThrough = false;
                            }
                        }
                        if (validFollowThrough && (now - lastShotTimestamp) > shotCooldownMs) {
                            lastShotTimestamp = now;
                            emitWearAnalysisShot(0L, pendingShotStartMs, "watch_auto");
                        }
                    }
                }
            } else if (analysisMode
                    && analysisAutoMode
                    && !manualAnalysisRecording
                    && !isWalkingBlocked
                    && linearMag >= shotThreshold
                    && (now - lastShotTimestamp) > shotCooldownMs
                    && hasSharpReleaseJerk(mag, minJerk)
                    && isTrueArcheryAnchor(
                            now,
                            stillWindowMs,
                            quietMeanMax,
                            quietPeakMax,
                            preRampMeanMax,
                            axisSpanMax,
                            gyroMeanMax,
                            gyroPeakMax
                    )) {
                pendingShotActive = true;
                pendingShotStartMs = now;
                pendingFollowSamples = 0;
                pendingFollowSumLin = 0.0;
                pendingFollowSumAx = 0.0;
                pendingFollowSumGyro = 0.0;
                pendingFollowGyroSamples = 0;
            }

            // Continuous bipedal wrist step detection (works in both Manual Counter and Analysis modes)
            if (mag >= 1.0 && mag <= 42.0) {
                stepGravityMag = 0.94 * stepGravityMag + 0.06 * mag;
                stepSmoothLin = 0.65 * stepSmoothLin + 0.35 * (mag - stepGravityMag);
                if (lastWatchTapMs > 0L && (now - lastWatchTapMs) < 1200L) {
                    accelCandidateStepCount = 0;
                    accelRhythmicCadenceActive = false;
                    stepPeakSeen = false;
                    stepArmedForPeak = true;
                } else {
                    long prevStepCand = accelCandidateStepCount > 0
                            ? accelCandidateStepT[(accelCandidateStepCount - 1) % 4]
                            : 0L;
                    if (prevStepCand > 0L && (now - prevStepCand) > 2200L) {
                        accelCandidateStepCount = 0;
                        accelRhythmicCadenceActive = false;
                        stepPeakSeen = false;
                        stepArmedForPeak = true;
                    }
                    if (stepArmedForPeak && stepSmoothLin >= 0.68) {
                        stepPeakSeen = true;
                        stepArmedForPeak = false;
                    } else if (stepPeakSeen && stepSmoothLin <= -0.28) {
                        stepPeakSeen = false;
                        stepArmedForPeak = true;
                        if ((now - lastShotTimestamp) > 1200L) {
                            evaluateRhythmicAccelStep(now);
                        }
                    }
                }
            }
            prevPrevDynLinear = prevDynLinear;
            prevDynLinear = dynamicLinear;

            // Record synchronized 3D + gyro sample into motion ring buffer
            motionT[motionIdx] = now;
            motionAx[motionIdx] = ax;
            motionAy[motionIdx] = ay;
            motionAz[motionIdx] = az;
            motionGy[motionIdx] = ((now - lastGyroSampleMs) <= 140L) ? latestGyroY : 0f;
            motionGz[motionIdx] = ((now - lastGyroSampleMs) <= 140L) ? latestGyroZ : 0f;
            motionMag[motionIdx] = mag;
            motionLin[motionIdx] = linearMag;
            motionGyro[motionIdx] = activeGyro;
            motionIdx = (motionIdx + 1) % MOTION_BUF;
            if (motionCount < MOTION_BUF) motionCount++;
        }
    }

    private boolean emitWearAnalysisShot(long explicitStartMs, long rawEndMs, String source) {
        if (motionCount < 10) return false;
        try {
            boolean hasExplicitWindow = explicitStartMs > 0L && (rawEndMs - explicitStartMs) >= 550L;
            long winStart = hasExplicitWindow
                    ? Math.max(rawEndMs - 30_000L, explicitStartMs)
                    : (rawEndMs - 10_000L);

            long releaseMs = rawEndMs;
            if (hasExplicitWindow) {
                long detectedSpikeTs = 0L;
                double peakLin = 0.0;
                for (int i = 0; i < motionCount - 2; i++) {
                    int idx = (motionIdx - 1 - i + MOTION_BUF) % MOTION_BUF;
                    int prevIdx = (motionIdx - 3 - i + MOTION_BUF) % MOTION_BUF;
                    long t = motionT[idx];
                    if (t < winStart + 900L) break;
                    if (t > rawEndMs || (rawEndMs - t) > 4500L) continue;
                    double jerk = Math.abs(motionMag[idx] - motionMag[prevIdx]);
                    double linDev = motionLin[idx];
                    if (jerk >= 6.5 && linDev >= 5.5 && linDev > peakLin) {
                        peakLin = linDev;
                        detectedSpikeTs = t;
                    }
                }
                releaseMs = (detectedSpikeTs > 0L)
                        ? detectedSpikeTs
                        : Math.max(winStart + 450L, rawEndMs - 120L);
            }

            long winEnd = releaseMs - 15L;
            int count = 0;
            for (int i = 0; i < motionCount; i++) {
                int idx = (motionIdx - 1 - i + MOTION_BUF) % MOTION_BUF;
                long t = motionT[idx];
                if (t < winStart) break;
                if (t <= winEnd) count++;
            }
            if (count < 8) return false;

            long[] ts = new long[count];
            float[] axArr = new float[count];
            float[] ayArr = new float[count];
            float[] azArr = new float[count];
            float[] gyArr = new float[count];
            float[] gzArr = new float[count];
            int k = count - 1;
            for (int i = 0; i < motionCount && k >= 0; i++) {
                int idx = (motionIdx - 1 - i + MOTION_BUF) % MOTION_BUF;
                long t = motionT[idx];
                if (t < winStart) break;
                if (t <= winEnd) {
                    ts[k] = t;
                    axArr[k] = motionAx[idx];
                    ayArr[k] = motionAy[idx];
                    azArr[k] = motionAz[idx];
                    gyArr[k] = motionGy[idx];
                    gzArr[k] = motionGz[idx];
                    k--;
                }
            }

            double refAx = 0.0, refAy = 0.0, refAz = 0.0;
            int refN = 0;
            for (int i = 0; i < count; i++) {
                if (ts[i] >= releaseMs - 700L && ts[i] <= releaseMs - 100L) {
                    refAx += axArr[i];
                    refAy += ayArr[i];
                    refAz += azArr[i];
                    refN++;
                }
            }
            if (refN < 4) {
                refAx = 0.0; refAy = 0.0; refAz = 0.0; refN = 0;
                for (int i = Math.max(0, count - 8); i < count; i++) {
                    refAx += axArr[i]; refAy += ayArr[i]; refAz += azArr[i]; refN++;
                }
            }
            refAx /= Math.max(1, refN);
            refAy /= Math.max(1, refN);
            refAz /= Math.max(1, refN);
            if (hasCalZeroVec) {
                double zNorm = Math.sqrt(calZeroAx * calZeroAx + calZeroAy * calZeroAy + calZeroAz * calZeroAz);
                if (zNorm >= 4.0 && zNorm <= 15.0) {
                    refAx = 0.88 * refAx + 0.12 * calZeroAx;
                    refAy = 0.88 * refAy + 0.12 * calZeroAy;
                    refAz = 0.88 * refAz + 0.12 * calZeroAz;
                }
            }
            double refNorm = Math.max(4.0, Math.sqrt(refAx * refAx + refAy * refAy + refAz * refAz));

            float wristSign = "RIGHT".equals(syncedBowWrist) ? -1f : 1f;
            double faceRadiusCm;
            if (distanceMeters <= 20) {
                faceRadiusCm = 20.0;
            } else if (distanceMeters <= 26) {
                faceRadiusCm = 30.0;
            } else if (distanceMeters <= 36) {
                faceRadiusCm = 40.0;
            } else if (distanceMeters <= 55) {
                faceRadiusCm = "Compound".equals(syncedBowType) ? 40.0 : 61.0;
            } else {
                faceRadiusCm = 61.0;
            }
            double distCm = Math.max(1000.0, distanceMeters * 100.0);

            float[] ptX = new float[count];
            float[] ptY = new float[count];
            double[] yawArr = new double[count];
            double[] pitchArr = new double[count];
            double[] energy = new double[count];
            double sAx = axArr[0], sAy = ayArr[0], sAz = azArr[0];
            double gYaw = 0.0, gPitch = 0.0;

            for (int i = 0; i < count; i++) {
                double dt = (i > 0) ? Math.max(0.002, Math.min(0.12, (ts[i] - ts[i - 1]) / 1000.0)) : 0.02;
                sAx = 0.82 * sAx + 0.18 * axArr[i];
                sAy = 0.82 * sAy + 0.18 * ayArr[i];
                sAz = 0.82 * sAz + 0.18 * azArr[i];

                double tiltH = ((sAy - refAy) / refNorm) * wristSign * 0.28;
                double tiltV = ((sAz - refAz) / refNorm) * 0.28;
                gYaw = 0.94 * (gYaw + gzArr[i] * dt * wristSign) + 0.06 * tiltH;
                gPitch = 0.94 * (gPitch + gyArr[i] * dt) + 0.06 * tiltV;

                yawArr[i] = tiltH * 0.65 + gYaw * 0.35;
                pitchArr[i] = tiltV * 0.65 + gPitch * 0.35;
                double lin = Math.abs(Math.sqrt(axArr[i] * axArr[i] + ayArr[i] * ayArr[i] + azArr[i] * azArr[i]) - SensorManager.GRAVITY_EARTH);
                energy[i] = lin + Math.hypot(gyArr[i], gzArr[i]) * 2.2;
            }

            // Zero-center final 1.2s aiming centroid so bow-lift gyro drift doesn't bias long-range traces
            double meanYaw = 0.0, meanPitch = 0.0;
            int centerN = 0;
            for (int i = 0; i < count; i++) {
                if (ts[i] >= releaseMs - 1200L) {
                    meanYaw += yawArr[i];
                    meanPitch += pitchArr[i];
                    centerN++;
                }
            }
            if (centerN < 3) {
                meanYaw = 0.0; meanPitch = 0.0; centerN = 0;
                for (int i = Math.max(0, count - 5); i < count; i++) {
                    meanYaw += yawArr[i]; meanPitch += pitchArr[i]; centerN++;
                }
            }
            meanYaw /= Math.max(1, centerN);
            meanPitch /= Math.max(1, centerN);

            double[] dxCmArr = new double[count];
            double[] dyCmArr = new double[count];
            for (int i = 0; i < count; i++) {
                double xCm = Math.tan(yawArr[i] - meanYaw) * distCm;
                double yCm = Math.tan(pitchArr[i] - meanPitch) * distCm;
                dxCmArr[i] = xCm;
                dyCmArr[i] = yCm;
                ptX[i] = (float) Math.max(-1.08, Math.min(1.08, xCm / faceRadiusCm));
                ptY[i] = (float) Math.max(-1.08, Math.min(1.08, yCm / faceRadiusCm));
            }

            // Detect settle index (transition from Preparatory to Aiming)
            double settleRadiusCm = faceRadiusCm * 0.36;
            int settleIdx = Math.max(0, count - 6);
            for (int i = count - 1; i >= 0; i--) {
                double radialCm = Math.hypot(dxCmArr[i], dyCmArr[i]);
                if (radialCm > settleRadiusCm || energy[i] > 2.6) {
                    settleIdx = Math.min(count - 2, i + 1);
                    break;
                }
                settleIdx = i;
            }

            // Detect real bow-lift / draw onset (in explicit INICIO->FINAL mode use start of window up to 10s prep)
            int prepStartIdx = Math.max(0, settleIdx - 1);
            if (hasExplicitWindow) {
                prepStartIdx = 0;
                for (int i = 0; i < settleIdx; i++) {
                    if (ts[settleIdx] - ts[i] <= 10_000L) {
                        prepStartIdx = i;
                        break;
                    }
                }
            } else {
                for (int i = settleIdx - 1; i >= 0; i--) {
                    if (ts[settleIdx] - ts[i] > 4500L) {
                        prepStartIdx = i;
                        break;
                    }
                    int lookbackIdx = Math.max(0, i - 3);
                    double dtSpanSec = Math.max(0.04, (ts[i] - ts[lookbackIdx]) / 1000.0);
                    double sweepRateCmPerSec = Math.hypot(
                            dxCmArr[i] - dxCmArr[lookbackIdx],
                            dyCmArr[i] - dyCmArr[lookbackIdx]
                    ) / dtSpanSec;
                    if ((settleIdx - i) > 6 && i > lookbackIdx && sweepRateCmPerSec < 6.0 && energy[i] < 0.28) {
                        prepStartIdx = i;
                        break;
                    }
                    prepStartIdx = i;
                }
            }

            float maxPrepCap = hasExplicitWindow ? 10.0f : 6.5f;
            float maxAimCap = hasExplicitWindow ? 24.0f : 14.0f;
            float prepSec = Math.max(0.4f, Math.min(maxPrepCap, Math.round(((ts[settleIdx] - ts[prepStartIdx]) / 100f)) / 10f));
            float aimSec = Math.max(0.5f, Math.min(maxAimCap, Math.round(((ts[count - 1] - ts[settleIdx]) / 100f)) / 10f));

            double meanAimX = 0.0, meanAimY = 0.0;
            int aimN = Math.max(1, count - settleIdx);
            for (int i = settleIdx; i < count; i++) {
                meanAimX += ptX[i];
                meanAimY += ptY[i];
            }
            meanAimX /= aimN;
            meanAimY /= aimN;

            double sumSqRad = 0.0;
            for (int i = settleIdx; i < count; i++) {
                double dx = (ptX[i] - meanAimX) * faceRadiusCm;
                double dy = (ptY[i] - meanAimY) * faceRadiusCm;
                sumSqRad += dx * dx + dy * dy;
            }
            float swayCm = Math.max(0.3f, Math.min((float) faceRadiusCm, Math.round((float) Math.sqrt(sumSqRad / aimN) * 10f) / 10f));
            int stabPct = Math.max(38, Math.min(99, (int) Math.round(100.0 - (swayCm / faceRadiusCm) * 82.0)));

            int preRelIdx = count - 1;
            for (int i = count - 1; i >= 0; i--) {
                if (ts[count - 1] - ts[i] >= 480L) {
                    preRelIdx = i;
                    break;
                }
            }
            float relJumpCm = Math.max(0.1f, Math.min(20.0f, Math.round((float) (Math.hypot(ptX[count - 1] - ptX[preRelIdx], ptY[count - 1] - ptY[preRelIdx]) * faceRadiusCm) * 10f) / 10f));

            int prepOutN = Math.min(10, Math.max(2, settleIdx - prepStartIdx + 1));
            float[] pX = new float[prepOutN];
            float[] pY = new float[prepOutN];
            JSONArray pJson = new JSONArray();
            for (int j = 0; j < prepOutN; j++) {
                int idx = prepStartIdx + Math.round(((float) j / Math.max(1, prepOutN - 1)) * (settleIdx - prepStartIdx));
                idx = Math.max(0, Math.min(count - 1, idx));
                double rxD = Math.round(ptX[idx] * 1000.0) / 1000.0;
                double ryD = Math.round(ptY[idx] * 1000.0) / 1000.0;
                pX[j] = (float) rxD;
                pY[j] = (float) ryD;
                JSONArray pair = new JSONArray();
                pair.put(rxD);
                pair.put(ryD);
                pJson.put(pair);
            }

            int aimOutN = Math.min(22, Math.max(2, count - settleIdx));
            float[] aX = new float[aimOutN];
            float[] aY = new float[aimOutN];
            JSONArray aJson = new JSONArray();
            for (int j = 0; j < aimOutN; j++) {
                int idx = settleIdx + Math.round(((float) j / Math.max(1, aimOutN - 1)) * (count - 1 - settleIdx));
                idx = Math.max(0, Math.min(count - 1, idx));
                double axD = Math.round(ptX[idx] * 1000.0) / 1000.0;
                double ayD = Math.round(ptY[idx] * 1000.0) / 1000.0;
                aX[j] = (float) axD;
                aY[j] = (float) ayD;
                JSONArray pair = new JSONArray();
                pair.put(axD);
                pair.put(ayD);
                aJson.put(pair);
            }

            float rX = aX[aimOutN - 1];
            float rY = aY[aimOutN - 1];
            JSONArray rJson = new JSONArray();
            rJson.put(Math.round(rX * 1000.0) / 1000.0);
            rJson.put(Math.round(rY * 1000.0) / 1000.0);

            markUserActivity(true);
            arrowCount++;
            int shotNum = arrowCount;
            lastAnalysisShotNum = shotNum;
            lastPrepSec = prepSec;
            lastAimSec = aimSec;
            lastSwayCm = swayCm;
            lastStabilityPct = stabPct;
            lastShotHrBpm = (syncedHeartRateBpm >= 30 && syncedHeartRateBpm <= 245) ? syncedHeartRateBpm : 0;
            lastPrepX = pX;
            lastPrepY = pY;
            lastAimX = aX;
            lastAimY = aY;
            lastRelX = rX;
            lastRelY = rY;

            JSONObject compact = new JSONObject();
            compact.put("id", "SHOT-" + releaseMs + "-" + shotNum);
            compact.put("n", shotNum);
            compact.put("ts", releaseMs);
            compact.put("d", distanceMeters);
            compact.put("bowType", syncedBowType);
            compact.put("prepSec", Math.round(prepSec * 10.0) / 10.0);
            compact.put("aimSec", Math.round(aimSec * 10.0) / 10.0);
            compact.put("stab", stabPct);
            compact.put("swayCm", Math.round(swayCm * 10.0) / 10.0);
            compact.put("relCm", Math.round(relJumpCm * 10.0) / 10.0);
            if (lastShotHrBpm > 0) {
                compact.put("bpm", lastShotHrBpm);
            }
            compact.put("p", pJson);
            compact.put("a", aJson);
            compact.put("r", rJson);

            JSONObject cmd = new JSONObject();
            cmd.put("type", "ANALYSIS_SHOT");
            cmd.put("source", source);
            cmd.put("analysisShotJson", compact.toString());
            if (lastShotHrBpm > 0) {
                cmd.put("heartRateBpm", lastShotHrBpm);
            }

            triggerHaptic(55);
            saveState();
            sendToPhone(cmd.toString());
            runOnUiThread(() -> {
                if (canvasView != null) canvasView.invalidate();
            });
            return true;
        } catch (Exception ignored) {}
        return false;
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
        private final RectF btnHeartRateAction = new RectF();
        private final RectF btnCloudMid = new RectF();
        private final RectF btnCloudSave = new RectF();
        private final RectF[] digitBoxes = new RectF[6];
        private final RectF[] scoreButtons = new RectF[12];
        private final String[] scoreLabels = new String[]{
            "X", "10", "9", "8",
            "7", "6", "5", "4",
            "3", "2", "1", "M"
        };

        public WearCanvasView(Context context) {
            super(context);
            for (int i = 0; i < 12; i++) {
                scoreButtons[i] = new RectF();
            }
            for (int i = 0; i < 6; i++) {
                digitBoxes[i] = new RectF();
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
                    float scale = Math.max(0.75f, Math.min(getWidth(), getHeight()) / 240f);
                    if (!swipeHandledThisGesture && Math.hypot(e.getX() - touchDownX, e.getY() - touchDownY) <= (20f * scale)) {
                        handleTap(e.getX(), e.getY());
                    }
                    return true;
                }

                @Override
                public boolean onFling(MotionEvent e1, MotionEvent e2, float velocityX, float velocityY) {
                    if (e1 == null || e2 == null) return false;
                    float dx = e2.getX() - e1.getX();
                    float dy = e2.getY() - e1.getY();
                    float scale = Math.max(0.75f, Math.min(getWidth(), getHeight()) / 240f);
                    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > (28f * scale)) {
                        swipeHandledThisGesture = true;
                        handleHorizontalSwipe(dx);
                        return true;
                    }
                    return false;
                }
            });
        }

        private float touchDownX = 0f;
        private float touchDownY = 0f;
        private boolean swipeHandledThisGesture = false;

        private void handleHorizontalSwipe(float dx) {
            if (analysisMode) {
                analysisPage = (dx < 0) ? 1 : 0;
            } else if (dx < 0) {
                isEditingCode = false;
                screenIndex = (screenIndex + 1) % 5;
            } else {
                if (screenIndex == 4 && isEditingCode) {
                    isEditingCode = false;
                } else {
                    screenIndex = (screenIndex + 4) % 5;
                }
            }
            syncBackNavigationCallback();
            markUserActivity(false);
            triggerHaptic(20);
            invalidate();
        }

        @Override
        protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
            super.onLayout(changed, left, top, right, bottom);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int w = right - left;
                int h = bottom - top;
                if (w > 0 && h > 0) {
                    try {
                        float density = getResources().getDisplayMetrics().density;
                        int exclH = Math.min(h, Math.round(200f * density));
                        int exclTop = Math.max(0, (h - exclH) / 2);
                        setSystemGestureExclusionRects(
                                java.util.Collections.singletonList(new Rect(0, exclTop, w, exclTop + exclH))
                        );
                    } catch (Throwable ignored) {}
                }
            }
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_DOWN) {
                touchDownX = event.getX();
                touchDownY = event.getY();
                swipeHandledThisGesture = false;
                if (getParent() != null) {
                    getParent().requestDisallowInterceptTouchEvent(true);
                }
            } else if (action == MotionEvent.ACTION_MOVE) {
                if (getParent() != null) {
                    getParent().requestDisallowInterceptTouchEvent(true);
                }
            }
            boolean handled = gestureDetector.onTouchEvent(event);
            if (action == MotionEvent.ACTION_UP && !swipeHandledThisGesture) {
                float dx = event.getX() - touchDownX;
                float dy = event.getY() - touchDownY;
                float scale = Math.max(0.75f, Math.min(getWidth(), getHeight()) / 240f);
                if (Math.abs(dx) > (32f * scale) && Math.abs(dx) > (Math.abs(dy) * 1.2f)) {
                    swipeHandledThisGesture = true;
                    handleHorizontalSwipe(dx);
                    return true;
                }
            }
            return handled || super.onTouchEvent(event);
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
            markUserActivity(true);
            arrowCount++;
            mPendingUnackedDelta += 1;
            triggerHaptic(45);
            saveState();
            sendToPhone("{\"type\":\"INCREMENT_ARROW\",\"delta\":1,\"source\":\"watch_manual\"}");
            invalidate();
        }

        private void decrementArrowManually() {
            if (arrowCount > 0) {
                markUserActivity(true);
                arrowCount--;
                mPendingUnackedDelta -= 1;
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
            } else {
                markUserActivity(false);
            }
        }

        private void handleTap(float x, float y) {
            lastWatchTapMs = System.currentTimeMillis();
            if (wakeLock != null && !wakeLock.isHeld()) {
                try {
                    wakeLock.acquire(4 * 60 * 60 * 1000L);
                } catch (Exception ignored) {}
            }
            int h = getHeight();

            if (analysisMode) {
                if (y > h * 0.90f) {
                    analysisPage = (analysisPage == 0) ? 1 : 0;
                    syncBackNavigationCallback();
                    markUserActivity(false);
                    triggerHaptic(20);
                    invalidate();
                    return;
                }
                if (analysisPage == 0) {
                    float scalePad = Math.max(0.75f, Math.min(getWidth(), getHeight()) / 240f) * 8f;
                    if (x >= (btnLeftPrimary.left - scalePad) && x <= (btnLeftPrimary.right + scalePad)
                            && y >= (btnLeftPrimary.top - scalePad) && y <= (btnLeftPrimary.bottom + scalePad)) {
                        toggleManualAnalysisFromWatchHardware();
                        return;
                    }
                    if (btnToggleDetector.contains(x, y)) {
                        analysisPage = 1;
                        syncBackNavigationCallback();
                        triggerHaptic(20);
                        invalidate();
                        return;
                    }
                    if (btnCenterMetrics.contains(x, y)) {
                        toggleManualAnalysisFromWatchHardware();
                        return;
                    }
                } else if (analysisPage == 1) {
                    if (btnHeartRateAction.contains(x, y)) {
                        triggerHaptic(25);
                        requestHeartRatePermissionInteractive();
                        invalidate();
                        return;
                    }
                }
                markUserActivity(false);
                return;
            }

            // Bottom page indicator tap switches screen
            if (y > h * 0.90f) {
                isEditingCode = false;
                screenIndex = (screenIndex + 1) % 5;
                markUserActivity(false);
                triggerHaptic(20);
                invalidate();
                return;
            }

            if (screenIndex == 0) {
                // Deliberate +1 Button ONLY (prevents accidental sleeve/quiver/shaft screen touches on 0000 chassis)
                if (btnLeftPrimary.contains(x, y)) {
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
                    markUserActivity(false);
                    triggerHaptic(20);
                    screenIndex = 2;
                    invalidate();
                    return;
                }
            } else if (screenIndex == 1) {
                for (int i = 0; i < 12; i++) {
                    if (scoreButtons[i].contains(x, y)) {
                        markUserActivity(true);
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
                        markUserActivity(true);
                        String removed = currentEndArrows.remove(currentEndArrows.size() - 1);
                        int pts = "X".equals(removed) || "10".equals(removed) ? 10 : ("M".equals(removed) ? 0 : Integer.parseInt(removed));
                        totalScore = Math.max(0, totalScore - pts);
                        totalScoredArrows = Math.max(0, totalScoredArrows - 1);
                        arrowCount = Math.max(0, arrowCount - 1);
                        triggerHaptic(25);
                        saveState();
                        sendToPhone("{\"type\":\"UNDO_ARROW\",\"totalScore\":" + totalScore + "}");
                        invalidate();
                    } else {
                        markUserActivity(false);
                    }
                    return;
                }
                if (btnRightSecondary.contains(x, y)) {
                    if (!currentEndArrows.isEmpty()) {
                        markUserActivity(true);
                        currentEndArrows.clear();
                        currentEnd = Math.min(syncedEndsCount, currentEnd + 1);
                        triggerHaptic(45);
                        saveState();
                        sendToPhone("{\"type\":\"NEXT_END\"}");
                        invalidate();
                    } else {
                        markUserActivity(false);
                    }
                    return;
                }
            } else if (screenIndex == 2) {
                if (btnHeartRateAction.contains(x, y)) {
                    markUserActivity(true);
                    triggerHaptic(25);
                    requestHeartRatePermissionInteractive();
                    invalidate();
                    return;
                }
                if (btnLeftPrimary.contains(x, y)) {
                    markUserActivity(true);
                    triggerHaptic(25);
                    syncTelemetryToPhone();
                    sendToPhone("/archery101010/ping", "{\"type\":\"PING\"}", false);
                    sendToPhone("{\"type\":\"REQUEST_STATE\"}");
                    if (hasPairingCode && pairingCode.length() == 6) {
                        pollFirestoreCloud();
                    }
                    invalidate();
                    return;
                }
            } else if (screenIndex == 3) {
                if (btnLeftPrimary.contains(x, y)) {
                    markUserActivity(true);
                    triggerHaptic(70);
                    lastFinishedTimestampMs = System.currentTimeMillis();
                    lastFinishedSessionId = currentSessionId;
                    sendToPhone("{\"type\":\"FINISH_SESSION_FROM_WATCH\"}");
                    resetWatchSessionCounters(true);
                    screenIndex = 0;
                    invalidate();
                    return;
                }
            } else if (screenIndex == 4) {
                for (int di = 0; di < 6; di++) {
                    if (digitBoxes[di].contains(x, y)) {
                        isEditingCode = true;
                        if (editDigitPos == di) {
                            adjustSelectedCodeDigit(1);
                        } else {
                            editDigitPos = di;
                            markUserActivity(true);
                            triggerHaptic(20);
                            invalidate();
                        }
                        return;
                    }
                }
                if (btnLeftPrimary.contains(x, y)) {
                    adjustSelectedCodeDigit(-1);
                    return;
                }
                if (btnCloudMid.contains(x, y)) {
                    isEditingCode = true;
                    editDigitPos = (editDigitPos + 1) % 6;
                    markUserActivity(true);
                    triggerHaptic(20);
                    invalidate();
                    return;
                }
                if (btnRightSecondary.contains(x, y)) {
                    adjustSelectedCodeDigit(1);
                    return;
                }
                if (btnCloudSave.contains(x, y)) {
                    commitPairingDigits();
                    return;
                }
            }
            markUserActivity(false);
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
                Bitmap scaled = Bitmap.createScaledBitmap(mid, targetWidthPx, targetHeightPx, true);
                if (mid != scaled && mid != rawBrandLogo) {
                    mid.recycle();
                }
                // Boost sub-pixel alpha from downsampling so white and 101010 colors have 100% full brightness
                Bitmap bright = scaled.copy(Bitmap.Config.ARGB_8888, true);
                int w = bright.getWidth();
                int h = bright.getHeight();
                int[] pixels = new int[w * h];
                bright.getPixels(pixels, 0, w, 0, 0, w, h);
                for (int i = 0; i < pixels.length; i++) {
                    int p = pixels[i];
                    int a = (p >>> 24) & 0xFF;
                    if (a > 6) {
                        int boostedA = Math.min(255, Math.round(a * 1.9f));
                        pixels[i] = (boostedA << 24) | (p & 0x00FFFFFF);
                    }
                }
                bright.setPixels(pixels, 0, w, 0, 0, w, h);
                if (scaled != bright && scaled != rawBrandLogo) {
                    scaled.recycle();
                }
                scaledBrandLogo = bright;
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
            int targetLogoW = Math.round((isRound ? 114f : 124f) * scale);
            Bitmap logo = getSupersampledLogo(targetLogoW);
            float logoTopY = 38.5f * scale;

            // Ensure Paint is at 100% opacity (255) before drawing the brand logo bitmap
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            paint.setAlpha(255);
            paint.setFilterBitmap(true);

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
            syncBackNavigationCallback();
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
            paint.setColor(Color.WHITE);
            paint.setAlpha(255);

            if (analysisMode) {
                if (analysisPage == 0) {
                    drawAnalysisDianaScreen(canvas, cx, cy, h, scale, isRound);
                } else {
                    drawAnalysisMetricsScreen(canvas, cx, h, scale, isRound, wMult);
                }
                float dotY = h - 13.5f * scale;
                float dotGap = 4.5f * scale;
                float activeW = 11.0f * scale;
                float inactiveW = 3.6f * scale;
                float dotH = 3.6f * scale;
                float totalDotsW = activeW + inactiveW + dotGap;
                float curX = cx - totalDotsW / 2f;
                for (int i = 0; i < 2; i++) {
                    float itemW = (i == analysisPage) ? activeW : inactiveW;
                    rect.set(curX, dotY - dotH / 2f, curX + itemW, dotY + dotH / 2f);
                    paint.setColor(i == analysisPage ? Color.parseColor("#00BFFF") : Color.parseColor("#38FFFFFF"));
                    canvas.drawRoundRect(rect, dotH / 2f, dotH / 2f, paint);
                    curX += itemW + dotGap;
                }
                return;
            }

            if (screenIndex == 0) {
                drawCounterScreen(canvas, cx, scale, isRound, wMult);
            } else if (screenIndex == 1) {
                drawScorePadScreen(canvas, cx, scale, isRound, wMult);
            } else if (screenIndex == 2) {
                drawBiometricsScreen(canvas, cx, scale, isRound, wMult);
            } else if (screenIndex == 3) {
                drawSummaryScreen(canvas, cx, scale, isRound, wMult);
            } else {
                drawCloudCodeScreen(canvas, cx, scale, isRound, wMult);
            }

            // Bottom Pill Pager Dots (y = 223f on virtual 240f grid)
            float dotY = h - 16.5f * scale;
            float dotGap = 4.2f * scale;
            float activeW = 11.0f * scale;
            float inactiveW = 3.6f * scale;
            float dotH = 3.6f * scale;
            float totalDotsW = activeW + 4f * inactiveW + 4f * dotGap;
            float curX = cx - totalDotsW / 2f;

            for (int i = 0; i < 5; i++) {
                float itemW = (i == screenIndex) ? activeW : inactiveW;
                rect.set(curX, dotY - dotH / 2f, curX + itemW, dotY + dotH / 2f);
                paint.setColor(i == screenIndex ? Color.parseColor("#00A8F3") : Color.parseColor("#38FFFFFF"));
                canvas.drawRoundRect(rect, dotH / 2f, dotH / 2f, paint);
                curX += itemW + dotGap;
            }
        }

        private void drawAnalysisDianaScreen(Canvas canvas, float cx, float cy, int h, float scale, boolean isRound) {
            int targetLogoW = Math.round((isRound ? 88f : 98f) * scale);
            Bitmap logo = getSupersampledLogo(targetLogoW);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            paint.setAlpha(255);
            if (logo != null) {
                canvas.drawBitmap(logo, Math.round(cx - logo.getWidth() / 2f), Math.round(11f * scale), paint);
            }

            // Top Live Status Pill (tap jumps to Shot Data screen)
            int shotNum = Math.max(lastAnalysisShotNum, arrowCount);
            float elapsedSec = manualAnalysisRecording
                    ? Math.max(0f, (System.currentTimeMillis() - manualAnalysisStartMs) / 1000f)
                    : 0f;
            String pillText = manualAnalysisRecording
                    ? (tr("GRABANDO · ", "REC · ") + String.format(Locale.US, "%.1fs", elapsedSec))
                    : (shotNum > 0
                        ? (tr("TIRO ", "SHOT ") + shotNum + " · " + distanceMeters + "M")
                        : (tr("LISTO · ", "READY · ") + distanceMeters + "M"));

            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(6.5f * scale);
            float textW = paint.measureText(pillText);
            float pillW = Math.max(96f * scale, textW + 19f * scale);
            float pillH = 14.5f * scale;
            float pillTop = 22.5f * scale;
            btnToggleDetector.set(cx - pillW / 2f, pillTop, cx + pillW / 2f, pillTop + pillH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(manualAnalysisRecording ? Color.parseColor("#171305") : Color.parseColor("#080B10"));
            canvas.drawRoundRect(btnToggleDetector, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(manualAnalysisRecording ? Color.parseColor("#C2FFE500") : Color.parseColor("#26FFFFFF"));
            canvas.drawRoundRect(btnToggleDetector, pillH / 2f, pillH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);

            float dotR = 1.9f * scale;
            float startX = cx - (dotR * 2f + 4.0f * scale + textW) / 2f;
            paint.setColor(manualAnalysisRecording ? Color.parseColor("#FFE500") : Color.parseColor("#00BFFF"));
            canvas.drawCircle(startX + dotR, btnToggleDetector.centerY(), dotR, paint);
            paint.setColor(Color.WHITE);
            paint.setTextAlign(Paint.Align.LEFT);
            Paint.FontMetrics fmTop = paint.getFontMetrics();
            canvas.drawText(pillText, startX + dotR * 2f + 4.0f * scale, btnToggleDetector.centerY() - (fmTop.ascent + fmTop.descent) / 2f, paint);

            // Centered High-Contrast Outdoor Brand-Line Diana (52f radius -> leaves full room for XL INICIO/FINAL button)
            float dCy = 95f * scale;
            float outerR = 52f * scale;
            btnCenterMetrics.set(cx - outerR, dCy - outerR, cx + outerR, dCy + outerR);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#020306"));
            canvas.drawCircle(cx, dCy, outerR, paint);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.8f * scale);
            paint.setColor(Color.parseColor("#E0FFFFFF"));
            canvas.drawCircle(cx, dCy, outerR, paint);

            // Broken cardinal axis lines
            paint.setStrokeWidth(0.85f * scale);
            paint.setColor(Color.parseColor("#33FFFFFF"));
            float coreGap = outerR * 0.24f;
            canvas.drawLine(cx, dCy - outerR, cx, dCy - coreGap, paint);
            canvas.drawLine(cx, dCy + coreGap, cx, dCy + outerR, paint);
            canvas.drawLine(cx - outerR, dCy, cx - coreGap, dCy, paint);
            canvas.drawLine(cx + coreGap, dCy, cx + outerR, dCy, paint);

            // White & Platinum Outer Rings (2, 3, 4)
            paint.setStrokeWidth(1.1f * scale);
            paint.setColor(Color.parseColor("#85FFFFFF"));
            canvas.drawCircle(cx, dCy, outerR * 0.9f, paint);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#AEB8C4D8"));
            canvas.drawCircle(cx, dCy, outerR * 0.8f, paint);
            paint.setStrokeWidth(1.05f * scale);
            paint.setColor(Color.parseColor("#7A9AA8C0"));
            canvas.drawCircle(cx, dCy, outerR * 0.7f, paint);

            // Cyan Rings (#00BFFF — 5, 6)
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#0D00BFFF"));
            canvas.drawCircle(cx, dCy, outerR * 0.6f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.8f * scale);
            paint.setColor(Color.parseColor("#00BFFF"));
            canvas.drawCircle(cx, dCy, outerR * 0.6f, paint);
            paint.setStrokeWidth(1.15f * scale);
            paint.setColor(Color.parseColor("#B800BFFF"));
            canvas.drawCircle(cx, dCy, outerR * 0.5f, paint);

            // Red Rings (#FF1E1E — 7, 8)
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#10FF1E1E"));
            canvas.drawCircle(cx, dCy, outerR * 0.4f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.9f * scale);
            paint.setColor(Color.parseColor("#FF1E1E"));
            canvas.drawCircle(cx, dCy, outerR * 0.4f, paint);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(Color.parseColor("#BCFF1E1E"));
            canvas.drawCircle(cx, dCy, outerR * 0.3f, paint);

            // Yellow Rings (#FFE500 — 9, 10) + Crosshair
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#17FFE500"));
            canvas.drawCircle(cx, dCy, outerR * 0.2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2.0f * scale);
            paint.setColor(Color.parseColor("#FFE500"));
            canvas.drawCircle(cx, dCy, outerR * 0.2f, paint);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#EBFFE500"));
            canvas.drawCircle(cx, dCy, outerR * 0.1f, paint);
            paint.setStrokeWidth(1.1f * scale);
            canvas.drawLine(cx - 2.4f * scale, dCy, cx + 2.4f * scale, dCy, paint);
            canvas.drawLine(cx, dCy - 2.4f * scale, cx, dCy + 2.4f * scale, paint);

            // Draw Shot Trajectory if captured
            if (lastAnalysisShotNum > 0 && lastAimX.length >= 2) {
                paint.setStrokeCap(Paint.Cap.ROUND);
                paint.setStrokeJoin(Paint.Join.ROUND);

                if (lastPrepX.length >= 2) {
                    Path prepPath = new Path();
                    prepPath.moveTo(cx + lastPrepX[0] * outerR, dCy + lastPrepY[0] * outerR);
                    for (int i = 1; i < lastPrepX.length; i++) {
                        prepPath.lineTo(cx + lastPrepX[i] * outerR, dCy + lastPrepY[i] * outerR);
                    }
                    paint.setPathEffect(null);
                    paint.setStrokeWidth(3.6f * scale);
                    paint.setColor(Color.parseColor("#020306"));
                    canvas.drawPath(prepPath, paint);

                    paint.setPathEffect(new DashPathEffect(new float[]{2.8f * scale, 3.0f * scale}, 0f));
                    paint.setStrokeWidth(1.75f * scale);
                    paint.setColor(Color.parseColor("#EBFFFFFF"));
                    canvas.drawPath(prepPath, paint);
                    paint.setPathEffect(null);
                }

                Path aimPath = new Path();
                aimPath.moveTo(cx + lastAimX[0] * outerR, dCy + lastAimY[0] * outerR);
                for (int i = 1; i < lastAimX.length; i++) {
                    aimPath.lineTo(cx + lastAimX[i] * outerR, dCy + lastAimY[i] * outerR);
                }
                paint.setStrokeWidth(4.2f * scale);
                paint.setColor(Color.parseColor("#020306"));
                canvas.drawPath(aimPath, paint);

                paint.setStrokeWidth(2.3f * scale);
                paint.setColor(Color.parseColor("#00BFFF"));
                canvas.drawPath(aimPath, paint);

                float rx = cx + lastRelX * outerR;
                float ry = dCy + lastRelY * outerR;
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.WHITE);
                canvas.drawCircle(rx, ry, 3.6f * scale, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.5f * scale);
                paint.setColor(Color.parseColor("#020306"));
                canvas.drawCircle(rx, ry, 3.6f * scale, paint);
            }

            // Single XL High-Visibility Toggle Button: ▶ INICIO (cyan) -> ■ FINAL (red)
            // Mathematically centered inside the round Galaxy Watch lower bezel (44f tall = ~48dp touch target)
            float btnW = (isRound ? 154f : 186f) * scale;
            float btnH = 44f * scale;
            float btnTop = 155f * scale;
            float btnRadius = btnH / 2f;

            btnLeftPrimary.set(cx - btnW / 2f, btnTop, cx + btnW / 2f, btnTop + btnH);
            btnRightSecondary.setEmpty();

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(manualAnalysisRecording ? Color.parseColor("#FF1E1E") : Color.parseColor("#00BFFF"));
            canvas.drawRoundRect(btnLeftPrimary, btnRadius, btnRadius, paint);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.4f * scale);
            paint.setColor(manualAnalysisRecording ? Color.parseColor("#66FFFFFF") : Color.parseColor("#33FFFFFF"));
            canvas.drawRoundRect(btnLeftPrimary, btnRadius, btnRadius, paint);

            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(13.5f * scale);
            paint.setColor(manualAnalysisRecording ? Color.WHITE : Color.BLACK);
            drawCenteredText(
                    canvas,
                    manualAnalysisRecording ? tr("■ FINAL", "■ END") : tr("▶ INICIO", "▶ START"),
                    btnLeftPrimary.centerX(),
                    btnLeftPrimary.centerY()
            );
        }

        private void drawAnalysisMetricsScreen(Canvas canvas, float cx, int h, float scale, boolean isRound, float wMult) {
            int shotNum = Math.max(lastAnalysisShotNum, arrowCount);
            String pill = shotNum > 0
                    ? (tr("DATOS · TIRO ", "DATA · SHOT ") + shotNum)
                    : tr("DATOS · EN ESPERA", "DATA · STANDBY");
            drawBrandHeaderAndPill(canvas, cx, scale, isRound, pill, false);

            float cardW = 166f * scale * wMult;
            float left = cx - cardW / 2f;
            float right = cx + cardW / 2f;

            // Row 1: Estabilidad
            float r1Top = 74f * scale;
            float r1H = 36f * scale;
            rect.set(left, r1Top, right, r1Top + r1H);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#0A0D14"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1f * scale);
            paint.setColor(Color.parseColor("#1AFFFFFF"));
            canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);

            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(7.2f * scale);
            paint.setColor(Color.WHITE);
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText(tr("ESTABILIDAD", "STABILITY"), left + 10f * scale, r1Top + 14.5f * scale, paint);
            paint.setTypeface(outfitBold);
            paint.setTextSize(7.0f * scale);
            canvas.drawText(lastAnalysisShotNum > 0 ? String.format(Locale.US, "±%.1f cm", lastSwayCm) : "—", left + 10f * scale, r1Top + 26.5f * scale, paint);

            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(15.5f * scale);
            paint.setTextAlign(Paint.Align.RIGHT);
            canvas.drawText(lastAnalysisShotNum > 0 ? (lastStabilityPct + "%") : "—", right - 10f * scale, r1Top + 24f * scale, paint);

            // Row 2: Preparatorio | Apuntado
            float r2Top = r1Top + r1H + 5f * scale;
            float r2H = 41f * scale;
            float gap = 5f * scale;
            float halfW = (cardW - gap) / 2f;

            for (int col = 0; col < 2; col++) {
                float cL = (col == 0) ? left : (left + halfW + gap);
                rect.set(cL, r2Top, cL + halfW, r2Top + r2H);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.parseColor("#0A0D14"));
                canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1f * scale);
                paint.setColor(Color.parseColor("#1AFFFFFF"));
                canvas.drawRoundRect(rect, 10f * scale, 10f * scale, paint);

                paint.setStyle(Paint.Style.FILL);
                paint.setTypeface(outfitExtraBold);
                paint.setTextSize(6.5f * scale);
                paint.setColor(col == 0 ? Color.WHITE : Color.parseColor("#00BFFF"));
                paint.setTextAlign(Paint.Align.LEFT);
                canvas.drawText(col == 0 ? tr("PREPARATORIO", "PREPARATORY") : tr("APUNTADO", "AIMING"), cL + 8f * scale, r2Top + 14f * scale, paint);

                paint.setColor(Color.WHITE);
                paint.setTextSize(15f * scale);
                String valStr = lastAnalysisShotNum > 0
                        ? String.format(Locale.US, "%.1fs", col == 0 ? lastPrepSec : lastAimSec)
                        : "—";
                canvas.drawText(valStr, cL + 8f * scale, r2Top + 33f * scale, paint);
            }

            // Row 3: Pulsaciones (interactive: tap to grant HR permission if missing)
            float r3Top = r2Top + r2H + 5f * scale;
            float r3H = 36f * scale;
            boolean needsHrPermAna = !hasHeartRatePermission();
            btnHeartRateAction.set(left, r3Top, right, r3Top + r3H);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(needsHrPermAna ? Color.parseColor("#141206") : Color.parseColor("#0A0D14"));
            canvas.drawRoundRect(btnHeartRateAction, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.1f * scale);
            paint.setColor(needsHrPermAna ? Color.parseColor("#B3FFE500") : Color.parseColor("#1AFFFFFF"));
            canvas.drawRoundRect(btnHeartRateAction, 10f * scale, 10f * scale, paint);

            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(7.2f * scale);
            paint.setColor(Color.WHITE);
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText(tr("PULSACIONES", "HEART RATE"), left + 10f * scale, r3Top + 14.5f * scale, paint);
            paint.setTypeface(outfitBold);
            paint.setTextSize(6.8f * scale);
            paint.setColor(needsHrPermAna ? Color.parseColor("#FFE500") : Color.parseColor("#94A3B8"));
            canvas.drawText(
                    needsHrPermAna ? tr("Toca para permitir", "Tap to allow") : tr("En vivo / disparo", "Live / release"),
                    left + 10f * scale,
                    r3Top + 26.5f * scale,
                    paint
            );

            int dispHr = isLocalHeartRateFresh()
                    ? localSensorHrBpm
                    : (lastShotHrBpm > 0 ? lastShotHrBpm : syncedHeartRateBpm);
            paint.setTypeface(outfitExtraBold);
            paint.setTextAlign(Paint.Align.RIGHT);
            if (needsHrPermAna) {
                paint.setTextSize(9.5f * scale);
                paint.setColor(Color.parseColor("#FFE500"));
                canvas.drawText(tr("PERMITIR", "ALLOW"), right - 10f * scale, r3Top + 22f * scale, paint);
            } else if (dispHr >= 30) {
                paint.setTextSize(14.5f * scale);
                paint.setColor(Color.WHITE);
                canvas.drawText(dispHr + " BPM", right - 10f * scale, r3Top + 23.5f * scale, paint);
            } else {
                paint.setTextSize(9.0f * scale);
                paint.setColor(Color.parseColor("#94A3B8"));
                canvas.drawText(tr("MIDIENDO...", "READING..."), right - 10f * scale, r3Top + 22f * scale, paint);
            }

            // Footer above dots
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(6.5f * scale);
            paint.setColor(Color.WHITE);
            String bowDisp = "Recurve".equals(syncedBowType)
                    ? tr("RECURVO", "RECURVE")
                    : ("Compound".equals(syncedBowType) ? tr("COMPUESTO", "COMPOUND") : "BAREBOW");
            drawCenteredText(canvas, distanceMeters + "M · " + bowDisp, cx, h - 25f * scale);
        }

        /**
         * SCREEN 0: MANUAL COUNTER (Mathematically centered inside 240f circular & square bezels)
         */
        private void drawCounterScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            boolean isSyncedNow = isPhoneConnected || isCloudSynced;
            String pillLabel = isSyncedNow
                    ? tr("CONECTADO · LIVE", "SYNCED · LIVE")
                    : tr("MODO MANUAL", "MANUAL MODE");
            drawBrandHeaderAndPill(canvas, cx, scale, isRound, pillLabel, false);

            // Outer Counter Chassis: VOLUMEN · FLECHAS / VOLUME · ARROWS (top = 74f, bottom = 134f)
            float chassisW = 168f * scale * wMult;
            float chassisH = 60f * scale;
            float chassisTop = 74f * scale;
            btnCounterChassis.set(cx - chassisW / 2f, chassisTop, cx + chassisW / 2f, chassisTop + chassisH);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(btnCounterChassis, 11f * scale, 11f * scale, paint);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#1AFFFFFF"));
            canvas.drawRoundRect(btnCounterChassis, 11f * scale, 11f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            // Label "VOLUMEN · FLECHAS" / "VOLUME · ARROWS"
            paint.setTypeface(outfitBold);
            paint.setTextSize(6.2f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            drawCenteredText(canvas, tr("VOLUMEN · FLECHAS", "VOLUME · ARROWS"), cx, chassisTop + 9.2f * scale);

            // Inner Dark Tray holding the 4 Digit Cells
            float trayPad = 6.5f * scale;
            float trayTop = chassisTop + 16.0f * scale;
            float trayBottom = chassisTop + chassisH - 5.5f * scale;
            rect.set(btnCounterChassis.left + trayPad, trayTop, btnCounterChassis.right - trayPad, trayBottom);
            paint.setColor(Color.parseColor("#030407"));
            canvas.drawRoundRect(rect, 7.5f * scale, 7.5f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(0.9f * scale);
            paint.setColor(Color.parseColor("#12FFFFFF"));
            canvas.drawRoundRect(rect, 7.5f * scale, 7.5f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            // 4 Digit Cells (0 0 0 0) in Outfit ExtraBold
            String digits = String.format(Locale.US, "%04d", Math.min(9999, Math.max(0, arrowCount)));
            float innerPad = 3.2f * scale;
            float cellGap = 4.0f * scale;
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
                paint.setTextSize(19.5f * scale);
                paint.setColor(isUnits ? Color.parseColor("#FFE500") : Color.WHITE);
                drawCenteredText(canvas, String.valueOf(digits.charAt(i)), rect.centerX(), rect.centerY());
            }

            // Symmetrical XL Tactile Row: [   −1   ]   [   +1   ] aligned edge-to-edge with Counter Chassis
            float rowW = chassisW;
            float btnGap = 8.0f * scale;
            float btnW = (rowW - btnGap) / 2f;
            float btnH = 36.0f * scale;
            float btnTop = 140.5f * scale;
            float btnRadius = 10.5f * scale;

            // Left XL Button: −1 (stored in btnRightSecondary)
            btnRightSecondary.set(cx - rowW / 2f, btnTop, cx - rowW / 2f + btnW, btnTop + btnH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#180709"));
            canvas.drawRoundRect(btnRightSecondary, btnRadius, btnRadius, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#C8FF1E1E"));
            canvas.drawRoundRect(btnRightSecondary, btnRadius, btnRadius, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(14.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "−1", btnRightSecondary.centerX(), btnRightSecondary.centerY());

            // Right XL Button: +1 (stored in btnLeftPrimary)
            btnLeftPrimary.set(cx + rowW / 2f - btnW, btnTop, cx + rowW / 2f, btnTop + btnH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#061523"));
            canvas.drawRoundRect(btnLeftPrimary, btnRadius, btnRadius, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnLeftPrimary, btnRadius, btnRadius, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(14.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "+1", btnLeftPrimary.centerX(), btnLeftPrimary.centerY());

            // Dedicated Bottom Telemetry Stack cleanly below XL buttons (tappable to jump to Screen 2)
            btnCenterMetrics.set(cx - 74f * scale, 180f * scale, cx + 74f * scale, 208f * scale);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(8.4f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, getFormattedWalkedPrimary() + " · " + getActiveKcal() + " kcal", cx, 187.5f * scale);

            paint.setTypeface(outfitBold);
            paint.setTextSize(6.4f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            int displayTanda = Math.max(1, currentEnd);
            drawCenteredText(canvas, tr("TANDA ", "END ") + displayTanda + " · " + distanceMeters + " M", cx, 199.0f * scale);
        }

        /**
         * SCREEN 1: XL 4x3 SCOREPAD (OPCIÓN A — 2.2x Tactile Area, Unified Top Bar, Full Round & Square Containment)
         */
        private void drawScorePadScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            // 1. Official 4K ARCHERY 101010 Logo mathematically contained inside top circular chord
            int targetLogoW = Math.round((isRound ? 112f : 126f) * scale);
            Bitmap logo = getSupersampledLogo(targetLogoW);
            float logoTopY = (isRound ? 19.0f : 12.0f) * scale;
            float logoBottomY = logoTopY + 9.5f * scale;

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            paint.setAlpha(255);
            paint.setFilterBitmap(true);

            if (logo != null) {
                float leftX = Math.round(cx - logo.getWidth() / 2f);
                canvas.drawBitmap(logo, leftX, Math.round(logoTopY), paint);
                logoBottomY = logoTopY + logo.getHeight();
            } else {
                paint.setTypeface(outfitExtraBold);
                paint.setTextSize(10.0f * scale);
                paint.setColor(Color.WHITE);
                drawCenteredText(canvas, "ARCHERY 101010", cx, logoTopY + 4.5f * scale);
            }

            // 2. Unified Compact Telemetry + End Slots Row: [T1·29P / E1·29P] [X][10][9][—][—][—]
            float barY = logoBottomY + 4.0f * scale;
            float barH = 16.5f * scale;
            float maxBarW = (isRound ? 154f : 204f) * scale;

            String ptsStr = tr("T", "E") + currentEnd + "·" + totalScore + "P";
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(7.8f * scale);
            float ptsTextW = paint.measureText(ptsStr);
            float ptsTagW = Math.min(62f * scale, ptsTextW + 11f * scale);

            int slotsCount = Math.max(1, Math.min(6, syncedArrowsPerEnd));
            float barGap = 4.0f * scale;
            float sGap = (slotsCount <= 3 ? 3.5f : 2.5f) * scale;
            float slotsAvailW = maxBarW - ptsTagW - barGap;
            float slotW = Math.min(22f * scale, (slotsAvailW - (slotsCount - 1) * sGap) / slotsCount);
            float slotsActualW = (slotsCount * slotW) + ((slotsCount - 1) * sGap);
            float totalBarW = ptsTagW + barGap + slotsActualW;
            float barStartX = cx - totalBarW / 2f;

            // Left Score Tag Pill [T1·29P / E1·29P]
            rect.set(barStartX, barY, barStartX + ptsTagW, barY + barH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#050D17"));
            canvas.drawRoundRect(rect, barH / 2f, barH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(rect, barH / 2f, barH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, ptsStr, rect.centerX(), rect.centerY());

            // Right End Slots
            float slotsStartX = barStartX + ptsTagW + barGap;
            for (int i = 0; i < slotsCount; i++) {
                float sx = slotsStartX + i * (slotW + sGap);
                rect.set(sx, barY, sx + slotW, barY + barH);
                boolean hasVal = i < currentEndArrows.size();
                String val = hasVal ? currentEndArrows.get(i) : "—";
                boolean isCurrentSlot = (i == currentEndArrows.size());

                int slotBorder;
                int slotTxt;
                if (hasVal) {
                    if ("X".equals(val) || "10".equals(val) || "9".equals(val)) {
                        slotBorder = Color.parseColor("#FFE500");
                        slotTxt = Color.parseColor("#FFE500");
                    } else if ("8".equals(val) || "7".equals(val)) {
                        slotBorder = Color.parseColor("#FF1E1E");
                        slotTxt = Color.WHITE;
                    } else if ("6".equals(val) || "5".equals(val)) {
                        slotBorder = Color.parseColor("#00A8F3");
                        slotTxt = Color.WHITE;
                    } else {
                        slotBorder = Color.parseColor("#64748B");
                        slotTxt = Color.WHITE;
                    }
                } else if (isCurrentSlot) {
                    slotBorder = Color.parseColor("#00A8F3");
                    slotTxt = Color.parseColor("#94A3B8");
                } else {
                    slotBorder = Color.parseColor("#334155");
                    slotTxt = Color.parseColor("#64748B");
                }

                paint.setStyle(Paint.Style.FILL);
                paint.setColor(isCurrentSlot ? Color.parseColor("#061320") : Color.parseColor("#07090E"));
                canvas.drawRoundRect(rect, 3.8f * scale, 3.8f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.0f * scale);
                paint.setColor(slotBorder);
                canvas.drawRoundRect(rect, 3.8f * scale, 3.8f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setTypeface(outfitExtraBold);
                paint.setTextSize((slotsCount <= 3 ? 8.8f : 7.6f) * scale);
                paint.setColor(slotTxt);
                drawCenteredText(canvas, val, rect.centerX(), rect.centerY());
            }

            // 3. Bottom Action Pills [BORRAR / DEL] [SIG. TANDA / NEXT END] anchored cleanly inside lower chord
            float btnH = 25.5f * scale;
            float btnY = (isRound ? 179.0f : 185.0f) * scale;
            float pairW = (isRound ? 158f : 196f) * scale;
            float pairGap = 6.0f * scale;
            float btnW = (pairW - pairGap) / 2f;

            // 4. 12 XL Score Keypad Buttons (4x3: X, 10..1, M) across full safe equatorial width
            float keypadW = (isRound ? 190f : 214f) * scale;
            float kGap = 3.8f * scale;
            float kStartY = barY + barH + 4.2f * scale;
            float kEndY = btnY - 4.5f * scale;
            float gridAvailH = kEndY - kStartY;
            float keyW = (keypadW - 3f * kGap) / 4f;
            float keyH = Math.max(24f * scale, (gridAvailH - 2f * kGap) / 3f);
            float kStartX = cx - keypadW / 2f;

            for (int i = 0; i < 12; i++) {
                int row = i / 4;
                int col = i % 4;
                float kx = kStartX + col * (keyW + kGap);
                float ky = kStartY + row * (keyH + kGap);
                scoreButtons[i].set(kx, ky, kx + keyW, ky + keyH);

                int fillHex;
                int strokeHex;
                int textHex;
                if (i <= 2) { // X, 10, 9 (Gold)
                    fillHex = Color.parseColor("#121107");
                    strokeHex = Color.parseColor("#FFE500");
                    textHex = Color.parseColor("#FFE500");
                } else if (i <= 4) { // 8, 7 (Red)
                    fillHex = Color.parseColor("#160708");
                    strokeHex = Color.parseColor("#FF1E1E");
                    textHex = Color.WHITE;
                } else if (i <= 6) { // 6, 5 (Cyan)
                    fillHex = Color.parseColor("#061320");
                    strokeHex = Color.parseColor("#00A8F3");
                    textHex = Color.WHITE;
                } else if (i <= 10) { // 4, 3, 2, 1
                    fillHex = Color.parseColor("#0B0E15");
                    strokeHex = Color.parseColor("#475569");
                    textHex = Color.WHITE;
                } else { // M
                    fillHex = Color.parseColor("#0B0E15");
                    strokeHex = Color.parseColor("#475569");
                    textHex = Color.parseColor("#CBD5E1");
                }

                paint.setStyle(Paint.Style.FILL);
                paint.setColor(fillHex);
                canvas.drawRoundRect(scoreButtons[i], 6.5f * scale, 6.5f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.3f * scale);
                paint.setColor(strokeHex);
                canvas.drawRoundRect(scoreButtons[i], 6.5f * scale, 6.5f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setTypeface(outfitExtraBold);
                paint.setTextSize(15.5f * scale);
                paint.setColor(textHex);
                drawCenteredText(canvas, scoreLabels[i], scoreButtons[i].centerX(), scoreButtons[i].centerY());
            }

            // 5. Render Bottom Action Pills: BORRAR / DEL and SIG. TANDA / NEXT END
            btnLeftPrimary.set(cx - pairW / 2f, btnY, cx - pairW / 2f + btnW, btnY + btnH);
            btnRightSecondary.set(cx + pairW / 2f - btnW, btnY, cx + pairW / 2f, btnY + btnH);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#0B0E15"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(Color.parseColor("#475569"));
            canvas.drawRoundRect(btnLeftPrimary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(8.2f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, tr("BORRAR", "DEL"), btnLeftPrimary.centerX(), btnLeftPrimary.centerY());

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#061523"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(Color.parseColor("#00A8F3"));
            canvas.drawRoundRect(btnRightSecondary, btnH / 2f, btnH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, tr("SIG. TANDA", "NEXT END"), btnRightSecondary.centerX(), btnRightSecondary.centerY());
        }

        /**
         * SCREEN 2: BIOMETRICS (DISTANCE / STEPS / KCAL / LIVE HEART RATE + PERMISSION CTA)
         */
        private void drawBiometricsScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            drawBrandHeaderAndPill(canvas, cx, scale, isRound, tr("BIOMETRÍA · PULSO", "BIOMETRICS · PULSE"), true);

            float cardW = 166f * scale * wMult;
            float cardH = 33.5f * scale;
            float badgeH = 14f * scale;

            // Card 1: WALKED DISTANCE + STEPS
            float card1Top = 73.5f * scale;
            rect.set(cx - cardW / 2f, card1Top, cx + cardW / 2f, card1Top + cardH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(rect, 9f * scale, 9f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#7300A8F3"));
            canvas.drawRoundRect(rect, 9f * scale, 9f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitBold);
            paint.setTextSize(5.9f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText(tr("DISTANCIA RECORRIDA", "WALKED DISTANCE"), rect.left + 9f * scale, card1Top + 12f * scale, paint);

            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(10.8f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText(getFormattedKmAndMi(), rect.left + 9f * scale, card1Top + 26f * scale, paint);

            String stepsBadgeTxt = stepsCount > 0
                    ? (stepsCount + " " + tr("PASOS", "STEPS"))
                    : tr("PASOS", "STEPS");
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(5.5f * scale);
            float badgeW = Math.max(34f * scale, paint.measureText(stepsBadgeTxt) + 8.5f * scale);
            RectF badgeRect = new RectF(rect.right - badgeW - 8f * scale, rect.centerY() - badgeH / 2f, rect.right - 8f * scale, rect.centerY() + badgeH / 2f);
            paint.setColor(Color.parseColor("#04101C"));
            canvas.drawRoundRect(badgeRect, 4f * scale, 4f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(0.9f * scale);
            paint.setColor(Color.parseColor("#8000A8F3"));
            canvas.drawRoundRect(badgeRect, 4f * scale, 4f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, stepsBadgeTxt, badgeRect.centerX(), badgeRect.centerY());

            // Card 2: GASTO ENERGÉTICO / ACTIVE ENERGY
            float card2Top = 111f * scale;
            rect.set(cx - cardW / 2f, card2Top, cx + cardW / 2f, card2Top + cardH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#07090E"));
            canvas.drawRoundRect(rect, 9f * scale, 9f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor(Color.parseColor("#73FF1E1E"));
            canvas.drawRoundRect(rect, 9f * scale, 9f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitBold);
            paint.setTextSize(5.9f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText(tr("GASTO ENERGÉTICO", "ACTIVE ENERGY"), rect.left + 9f * scale, card2Top + 12f * scale, paint);

            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(12.0f * scale);
            paint.setColor(Color.WHITE);
            canvas.drawText(getActiveKcal() + " kcal", rect.left + 9f * scale, card2Top + 26f * scale, paint);

            float badge2W = 36f * scale;
            badgeRect.set(rect.right - badge2W - 8f * scale, rect.centerY() - badgeH / 2f, rect.right - 8f * scale, rect.centerY() + badgeH / 2f);
            paint.setColor(Color.parseColor("#101008"));
            canvas.drawRoundRect(badgeRect, 4f * scale, 4f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(0.9f * scale);
            paint.setColor(Color.parseColor("#80FFE500"));
            canvas.drawRoundRect(badgeRect, 4f * scale, 4f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(5.8f * scale);
            paint.setColor(Color.parseColor("#FFE500"));
            drawCenteredText(canvas, tr("ACTIVA", "ACTIVE"), badgeRect.centerX(), badgeRect.centerY());

            // Card 3: LIVE HEART RATE + INTERACTIVE PERMISSION BUTTON (tap to grant/retry HR sensor)
            float card3Top = 148.5f * scale;
            float card3H = 36f * scale;
            boolean hasHrPerm = hasHeartRatePermission();
            int liveHr = isLocalHeartRateFresh() ? localSensorHrBpm : 0;
            btnHeartRateAction.set(cx - cardW / 2f, card3Top, cx + cardW / 2f, card3Top + card3H);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(!hasHrPerm ? Color.parseColor("#141206") : Color.parseColor("#07090E"));
            canvas.drawRoundRect(btnHeartRateAction, 9.5f * scale, 9.5f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.1f * scale);
            paint.setColor(!hasHrPerm
                    ? Color.parseColor("#FFE500")
                    : (liveHr >= 30 ? Color.parseColor("#8000C853") : Color.parseColor("#55FFFFFF")));
            canvas.drawRoundRect(btnHeartRateAction, 9.5f * scale, 9.5f * scale, paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setTypeface(outfitBold);
            paint.setTextSize(5.9f * scale);
            paint.setColor(!hasHrPerm ? Color.parseColor("#FFE500") : Color.parseColor("#8E96A4"));
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText(
                    !hasHrPerm ? tr("PERMISO DE PULSO", "PULSE PERMISSION") : tr("PULSACIONES", "HEART RATE"),
                    btnHeartRateAction.left + 9f * scale,
                    card3Top + 12.5f * scale,
                    paint
            );

            paint.setTypeface(outfitExtraBold);
            if (!hasHrPerm) {
                paint.setTextSize(10.5f * scale);
                paint.setColor(Color.WHITE);
                canvas.drawText(tr("TOCA PARA PERMITIR", "TAP TO ALLOW"), btnHeartRateAction.left + 9f * scale, card3Top + 27.5f * scale, paint);
            } else if (liveHr >= 30) {
                paint.setTextSize(13.0f * scale);
                paint.setColor(Color.WHITE);
                canvas.drawText(liveHr + " BPM", btnHeartRateAction.left + 9f * scale, card3Top + 28f * scale, paint);
                paint.setTextSize(6.2f * scale);
                paint.setColor(Color.parseColor("#00C853"));
                paint.setTextAlign(Paint.Align.RIGHT);
                canvas.drawText(tr("● EN VIVO", "● LIVE"), btnHeartRateAction.right - 9f * scale, card3Top + 22f * scale, paint);
            } else {
                paint.setTextSize(10.0f * scale);
                paint.setColor(Color.parseColor("#CBD5E1"));
                String hrWaitStr = "no_contact".equals(hrStatusCode)
                        ? tr("AJUSTA RELOJ", "ADJUST WATCH")
                        : tr("MIDIENDO...", "MEASURING...");
                canvas.drawText(hrWaitStr, btnHeartRateAction.left + 9f * scale, card3Top + 27.5f * scale, paint);
            }

            // Bottom Sync Subtitle (tap triggers immediate telemetry sync)
            btnLeftPrimary.set(cx - 72f * scale, 187f * scale, cx + 72f * scale, 206f * scale);
            paint.setTypeface(outfitBold);
            paint.setTextSize(6.2f * scale);
            paint.setColor(Color.parseColor("#8E96A4"));
            drawCenteredText(
                    canvas,
                    arrowCount + " " + tr("FL", "AR") + " · " + Math.round(drawWeightLbs) + " LBS · SYNC",
                    cx,
                    195.5f * scale
            );
        }

        /**
         * SCREEN 3: SESSION SUMMARY & SAVE SESSION (Mathematically centered: 39f..188f)
         */
        private void drawSummaryScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            boolean isSyncedNow = isPhoneConnected || isCloudSynced;
            drawBrandHeaderAndPill(
                    canvas,
                    cx,
                    scale,
                    isRound,
                    isSyncedNow ? tr("RESUMEN · CONECTADO", "SUMMARY · SYNCED") : tr("RESUMEN", "SUMMARY"),
                    false
            );

            float gridW = 166f * scale * wMult;
            float colGap = 5f * scale;
            float colW = (gridW - colGap) / 2f;
            float row1Top = 76f * scale;
            float row1H = 36f * scale;

            // Box 1: FLECHAS / ARROWS
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
            drawCenteredText(canvas, tr("FLECHAS", "ARROWS"), rect.centerX(), row1Top + 10.5f * scale);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(12.5f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, arrowCount + (isSpanishLocale() ? " FL" : " AR"), rect.centerX(), row1Top + 25f * scale);

            // Box 2: PUNTAJE · ENERGÍA / SCORE · ENERGY
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
            drawCenteredText(canvas, totalScore > 0 ? tr("PUNTAJE", "SCORE") : tr("ENERGÍA", "ENERGY"), rect.centerX(), row1Top + 10.5f * scale);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(12.2f * scale);
            paint.setColor(totalScore > 0 ? Color.parseColor("#FFE500") : Color.WHITE);
            drawCenteredText(canvas, totalScore > 0 ? (totalScore + " PTS") : (getActiveKcal() + " kcal"), rect.centerX(), row1Top + 25f * scale);

            // Box 3 (Full width): DISTANCIA TOTAL / TOTAL DISTANCE
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
            drawCenteredText(canvas, tr("DISTANCIA TOTAL", "TOTAL DISTANCE"), cx, row2Top + 10f * scale);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(11.0f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, getFormattedWalkedPrimary() + " · " + getActiveKcal() + " kcal", cx, row2Top + 23.5f * scale);

            // Bottom Action Button: GUARDAR SESIÓN / SAVE SESSION
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
            drawCenteredText(canvas, tr("GUARDAR SESIÓN", "SAVE SESSION"), btnLeftPrimary.centerX(), btnLeftPrimary.centerY());
        }

        /**
         * SCREEN 4: 6-DIGIT CLOUD CODE PAIRING (XL Tactile Digits & Buttons + Honest Live Cloud Status)
         */
        private void drawCloudCodeScreen(Canvas canvas, float cx, float scale, boolean isRound, float wMult) {
            String headerPill;
            boolean useYellowPill = false;
            if (isEditingCode) {
                headerPill = tr("DÍGITO ", "DIGIT ") + (editDigitPos + 1) + "/6";
                useYellowPill = true;
            } else if ("LINKING".equals(cloudLinkStatus)) {
                headerPill = tr("VINCULANDO...", "LINKING...");
                useYellowPill = true;
            } else if ("NOT_FOUND".equals(cloudLinkStatus)) {
                headerPill = tr("CÓDIGO INVÁLIDO", "INVALID CODE");
                useYellowPill = true;
            } else if ("NO_NET".equals(cloudLinkStatus)) {
                headerPill = tr("SIN INTERNET", "NO INTERNET");
                useYellowPill = true;
            } else if (isCloudSynced) {
                headerPill = tr("VINCULADO ✓", "SYNCED ✓");
            } else {
                headerPill = tr("CÓDIGO NUBE", "CLOUD CODE");
            }

            // Compact top logo & status pill to maximize tactile area for 6 digits + XL buttons
            int targetLogoW = Math.round((isRound ? 94f : 104f) * scale);
            Bitmap logo = getSupersampledLogo(targetLogoW);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            paint.setAlpha(255);
            if (logo != null) {
                canvas.drawBitmap(logo, Math.round(cx - logo.getWidth() / 2f), Math.round(24f * scale), paint);
            }
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(6.6f * scale);
            float pTxtW = paint.measureText(headerPill);
            float pW = Math.max(106f * scale, pTxtW + 22f * scale);
            float pH = 15.5f * scale;
            float pTop = 37f * scale;
            btnToggleDetector.set(cx - pW / 2f, pTop, cx + pW / 2f, pTop + pH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(useYellowPill ? Color.parseColor("#141206") : Color.parseColor("#040B12"));
            canvas.drawRoundRect(btnToggleDetector, pH / 2f, pH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.0f * scale);
            paint.setColor("NOT_FOUND".equals(cloudLinkStatus) || "NO_NET".equals(cloudLinkStatus)
                    ? Color.parseColor("#FF1E1E")
                    : (useYellowPill ? Color.parseColor("#B3FFE500") : Color.parseColor("#8000A8F3")));
            canvas.drawRoundRect(btnToggleDetector, pH / 2f, pH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, headerPill, btnToggleDetector.centerX(), btnToggleDetector.centerY());

            // 6 Large Tactile Digit Cells centered in widest equatorial band
            float dBoxW = 25.5f * scale * wMult;
            float dBoxH = 42f * scale;
            float dGap = 3.5f * scale;
            float dTotalW = (dBoxW * 6f) + (dGap * 5f);
            float dStartX = cx - (dTotalW / 2f);
            float dStartY = 62f * scale;

            for (int di = 0; di < 6; di++) {
                float dx = dStartX + di * (dBoxW + dGap);
                digitBoxes[di].set(dx, dStartY, dx + dBoxW, dStartY + dBoxH);
                boolean isSel = (di == editDigitPos);

                paint.setStyle(Paint.Style.FILL);
                paint.setColor(isSel ? Color.parseColor("#08192B") : Color.parseColor("#0B0E15"));
                canvas.drawRoundRect(digitBoxes[di], 6f * scale, 6f * scale, paint);

                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth((isSel ? 1.6f : 1.1f) * scale);
                paint.setColor(isSel ? Color.parseColor("#00BFFF") : Color.parseColor("#FFE500"));
                canvas.drawRoundRect(digitBoxes[di], 6f * scale, 6f * scale, paint);
                paint.setStyle(Paint.Style.FILL);

                paint.setTypeface(outfitExtraBold);
                paint.setTextSize(18f * scale);
                paint.setColor(isSel ? Color.WHITE : Color.parseColor("#FFE500"));
                drawCenteredText(canvas, String.valueOf(pairingDigits[di]), digitBoxes[di].centerX(), digitBoxes[di].centerY());
            }

            // XL Control Row: [ − ] | [ SIG > ] | [ + ] (35f tall!)
            float ctrlY = 110f * scale;
            float ctrlH = 35f * scale;
            float ctrlW = (isRound ? 174f : 196f) * scale;
            float cStartX = cx - ctrlW / 2f;
            float smallW = 50f * scale;
            float btnGap = 6f * scale;
            float midW = ctrlW - (2f * smallW) - (2f * btnGap);

            btnLeftPrimary.set(cStartX, ctrlY, cStartX + smallW, ctrlY + ctrlH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#180709"));
            canvas.drawRoundRect(btnLeftPrimary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#FF1E1E"));
            canvas.drawRoundRect(btnLeftPrimary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(16f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "−", btnLeftPrimary.centerX(), btnLeftPrimary.centerY());

            float midX = cStartX + smallW + btnGap;
            btnCloudMid.set(midX, ctrlY, midX + midW, ctrlY + ctrlH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#0B0E15"));
            canvas.drawRoundRect(btnCloudMid, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * scale);
            paint.setColor(Color.parseColor("#475569"));
            canvas.drawRoundRect(btnCloudMid, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(9.2f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, tr("SIG >", "NEXT >"), btnCloudMid.centerX(), btnCloudMid.centerY());

            float plusX = midX + midW + btnGap;
            btnRightSecondary.set(plusX, ctrlY, plusX + smallW, ctrlY + ctrlH);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#061523"));
            canvas.drawRoundRect(btnRightSecondary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(Color.parseColor("#00BFFF"));
            canvas.drawRoundRect(btnRightSecondary, 10f * scale, 10f * scale, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(16f * scale);
            paint.setColor(Color.WHITE);
            drawCenteredText(canvas, "+", btnRightSecondary.centerX(), btnRightSecondary.centerY());

            // XL Bottom Save / Link CTA (38f tall — impossible to miss!)
            float saveW = (isRound ? 150f : 178f) * scale;
            float saveH = 38f * scale;
            float saveY = 152f * scale;
            btnCloudSave.set(cx - saveW / 2f, saveY, cx + saveW / 2f, saveY + saveH);
            paint.setStyle(Paint.Style.FILL);
            boolean isErrorState = "NOT_FOUND".equals(cloudLinkStatus) || "NO_NET".equals(cloudLinkStatus);
            paint.setColor(isCloudSynced ? Color.parseColor("#051810") : Color.parseColor("#00BFFF"));
            canvas.drawRoundRect(btnCloudSave, saveH / 2f, saveH / 2f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * scale);
            paint.setColor(isCloudSynced
                    ? Color.parseColor("#00C853")
                    : (isErrorState ? Color.parseColor("#FFE500") : Color.parseColor("#40FFFFFF")));
            canvas.drawRoundRect(btnCloudSave, saveH / 2f, saveH / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(outfitExtraBold);
            paint.setTextSize(10.8f * scale);
            paint.setColor(isCloudSynced ? Color.WHITE : Color.BLACK);
            String saveCta;
            if ("LINKING".equals(cloudLinkStatus)) {
                saveCta = tr("CONECTANDO...", "LINKING...");
            } else if (isEditingCode) {
                saveCta = tr("VINCULAR", "LINK NOW");
            } else if (isErrorState) {
                saveCta = tr("REINTENTAR", "RETRY");
            } else if (isCloudSynced) {
                saveCta = tr("VINCULADO ✓", "SYNCED ✓");
            } else {
                saveCta = tr("VINCULAR", "LINK CODE");
            }
            drawCenteredText(canvas, saveCta, btnCloudSave.centerX(), btnCloudSave.centerY());
        }
    }
}
