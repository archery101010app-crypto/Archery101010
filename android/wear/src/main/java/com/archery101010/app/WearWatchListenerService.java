package com.archery101010.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataMap;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;

/**
 * Background WearableListenerService on the Wear OS Watch.
 * Allows the watch to respond to phone pings (/archery101010/ping -> /archery101010/pong)
 * and persist live training session state into SharedPreferences even before the archer
 * opens the watch app on their wrist.
 */
public class WearWatchListenerService extends WearableListenerService {
    private static final String PREFS_NAME = "archery_101010_wear_prefs";

    @Override
    public void onMessageReceived(MessageEvent event) {
        super.onMessageReceived(event);
        if (event == null || event.getPath() == null) return;
        String path = event.getPath();
        if (!path.startsWith("/archery101010/")) return;

        String payload = event.getData() != null
            ? new String(event.getData(), StandardCharsets.UTF_8)
            : "";

        WearMainActivity active = WearMainActivity.getActiveInstance();
        if (active != null) {
            // WearMainActivity already registers live MessageClient + DataClient listeners on MainLooper;
            // skip duplicate background forwarding so every phone message is processed once on the UI thread.
            return;
        }

        long now = System.currentTimeMillis();
        if ("/archery101010/ping".equals(path)) {
            byte[] pongBytes = ("{\"type\":\"PONG\",\"_ts\":" + now + "}").getBytes(StandardCharsets.UTF_8);
            replyToPhoneNode(event.getSourceNodeId(), "/archery101010/pong", pongBytes);
            return;
        }

        if ("/archery101010/hr_request".equals(path)) {
            replyBackgroundHeartRateStatus(event.getSourceNodeId(), now);
            return;
        }

        if (payload != null && !payload.isEmpty()) {
            persistSnapshotToWatchPrefs(payload);
        }
    }

    private void replyToPhoneNode(String sourceNodeId, String path, byte[] bytes) {
        if (sourceNodeId != null && !sourceNodeId.isEmpty()) {
            Wearable.getMessageClient(this).sendMessage(sourceNodeId, path, bytes);
        } else {
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                if (nodes != null) {
                    for (Node n : nodes) {
                        Wearable.getMessageClient(this).sendMessage(n.getId(), path, bytes);
                    }
                }
            });
        }
    }

    private void replyBackgroundHeartRateStatus(String sourceNodeId, long now) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            int savedBpm = prefs.getInt("lastLiveHrBpm", 0);
            long savedAt = prefs.getLong("lastLiveHrAtMs", 0L);
            JSONObject obj = new JSONObject();
            obj.put("type", "HR");
            if (savedBpm >= 30 && savedBpm <= 245 && (now - savedAt) < 35_000L) {
                obj.put("bpm", savedBpm);
                obj.put("status", "ok");
            } else {
                obj.put("bpm", 0);
                obj.put("status", "reading");
            }
            obj.put("_ts", now);
            replyToPhoneNode(sourceNodeId, "/archery101010/hr", obj.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {}
    }

    @Override
    public void onDataChanged(DataEventBuffer dataEvents) {
        super.onDataChanged(dataEvents);
        if (dataEvents == null) return;
        for (DataEvent event : dataEvents) {
            if (event.getType() == DataEvent.TYPE_CHANGED) {
                DataItem item = event.getDataItem();
                if (item != null && item.getUri() != null) {
                    String path = item.getUri().getPath();
                    if ("/archery101010/state".equals(path)) {
                        DataMap dataMap = DataMapItem.fromDataItem(item).getDataMap();
                        String snapshotJson = dataMap.getString("snapshot_json", "");
                        if (snapshotJson != null && !snapshotJson.isEmpty()) {
                            WearMainActivity active = WearMainActivity.getActiveInstance();
                            if (active == null) {
                                persistSnapshotToWatchPrefs(snapshotJson);
                            }
                        }
                    } else if ("/archery101010/hr_request".equals(path)) {
                        WearMainActivity active = WearMainActivity.getActiveInstance();
                        if (active == null) {
                            replyBackgroundHeartRateStatus("", System.currentTimeMillis());
                        }
                    }
                }
            }
        }
    }

    private void persistSnapshotToWatchPrefs(String json) {
        try {
            JSONObject rootObj = new JSONObject(json);
            if ("SET_SENSITIVITY".equals(rootObj.optString("type", ""))) {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                SharedPreferences.Editor editor = prefs.edit();
                editor.putInt("sensitivityLevel", Math.max(0, Math.min(2, rootObj.optInt("sensitivityLevel", 1))));
                editor.putBoolean("autoDetectEnabled_v2", false);
                editor.apply();
                return;
            }

            JSONObject obj = rootObj;
            if (rootObj.has("payload") && rootObj.optJSONObject("payload") != null) {
                obj = rootObj.optJSONObject("payload");
            }
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();

            String existingDeviceId = prefs.getString("watchDeviceId", "");
            if (existingDeviceId == null || existingDeviceId.trim().isEmpty() || existingDeviceId.length() > 80) {
                editor.putString("watchDeviceId", "WEAR-" + UUID.randomUUID().toString());
            }

            String incomingPairingCode = obj.optString("pairingCode", rootObj.optString("pairingCode", "")).trim();
            String incomingSessionToken = obj.optString("sessionToken", rootObj.optString("sessionToken", "")).trim();
            boolean validToken = incomingSessionToken.matches("^[A-Za-z0-9_-]{32,64}$");
            if (incomingPairingCode.matches("^[0-9]{6}$")) {
                String prevPairingCode = prefs.getString("pairingCode", "");
                editor.putString("pairingCode", incomingPairingCode);
                editor.putString("cloudPairingCode", incomingPairingCode);
                if (!incomingPairingCode.equals(prevPairingCode) && !validToken) {
                    editor.remove("cloudSessionToken");
                }
            }
            if (validToken) {
                editor.putString("cloudSessionToken", incomingSessionToken);
            }

            String savedSessionId = prefs.getString("currentSessionId", "");
            String incomingSessionId = obj.optString("sessionId", "");
            boolean sessionActive = obj.optBoolean("sessionActive", rootObj.optBoolean("sessionActive", true));
            editor.putBoolean("sessionActive", sessionActive);
            boolean isNewSession = !incomingSessionId.isEmpty() && !incomingSessionId.equals(savedSessionId);

            if (!sessionActive || isNewSession) {
                editor.putInt("arrowCount", 0);
                editor.putInt("totalScore", 0);
                editor.putInt("totalScoredArrows", 0);
                editor.putInt("currentEnd", 1);
                editor.putInt("stepsCount", 0);
                editor.putFloat("walkedMeters", 0f);
                if (!sessionActive) {
                    editor.putString("currentSessionId", "");
                    editor.apply();
                    return;
                }
            }

            if (!incomingSessionId.isEmpty()) {
                editor.putString("currentSessionId", incomingSessionId);
            }
            if (obj.has("arrowsCount")) {
                int arrows = Math.max(0, obj.optInt("arrowsCount", 0));
                editor.putInt("arrowCount", arrows);
                editor.putInt("totalScoredArrows", arrows);
            }
            if (obj.has("totalScore")) {
                editor.putInt("totalScore", Math.max(0, obj.optInt("totalScore", 0)));
            }
            if (obj.has("currentEndIndex")) {
                editor.putInt("currentEnd", obj.optInt("currentEndIndex", 0) + 1);
            }
            if (obj.has("arrowsPerEnd")) {
                editor.putInt("syncedArrowsPerEnd", Math.max(1, obj.optInt("arrowsPerEnd", 6)));
            }
            if (obj.has("endsCount")) {
                editor.putInt("syncedEndsCount", Math.max(1, obj.optInt("endsCount", 12)));
            }
            if (obj.has("stepsCount")) {
                editor.putInt("stepsCount", Math.max(0, obj.optInt("stepsCount", 0)));
            }
            if (obj.has("distanceWalkedM")) {
                editor.putFloat("walkedMeters", Math.max(0f, (float) obj.optDouble("distanceWalkedM", 0.0)));
            }
            editor.apply();
        } catch (Exception ignored) {}
    }
}
