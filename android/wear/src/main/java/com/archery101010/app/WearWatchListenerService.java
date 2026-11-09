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
            active.onBackgroundPhoneEvent(path, payload, event.getSourceNodeId());
            return;
        }

        long now = System.currentTimeMillis();
        if ("/archery101010/ping".equals(path)) {
            byte[] pongBytes = ("{\"type\":\"PONG\",\"_ts\":" + now + "}").getBytes(StandardCharsets.UTF_8);
            if (event.getSourceNodeId() != null && !event.getSourceNodeId().isEmpty()) {
                Wearable.getMessageClient(this).sendMessage(event.getSourceNodeId(), "/archery101010/pong", pongBytes);
            } else {
                Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                    if (nodes != null) {
                        for (Node n : nodes) {
                            Wearable.getMessageClient(this).sendMessage(n.getId(), "/archery101010/pong", pongBytes);
                        }
                    }
                });
            }
            return;
        }

        if (payload != null && !payload.isEmpty()) {
            persistSnapshotToWatchPrefs(payload);
        }
    }

    @Override
    public void onDataChanged(DataEventBuffer dataEvents) {
        super.onDataChanged(dataEvents);
        if (dataEvents == null) return;
        for (DataEvent event : dataEvents) {
            if (event.getType() == DataEvent.TYPE_CHANGED) {
                DataItem item = event.getDataItem();
                if (item != null && item.getUri() != null && "/archery101010/state".equals(item.getUri().getPath())) {
                    DataMap dataMap = DataMapItem.fromDataItem(item).getDataMap();
                    String snapshotJson = dataMap.getString("snapshot_json", "");
                    if (snapshotJson != null && !snapshotJson.isEmpty()) {
                        WearMainActivity active = WearMainActivity.getActiveInstance();
                        if (active != null) {
                            active.onBackgroundPhoneEvent("/archery101010/telemetry", snapshotJson, "");
                        } else {
                            persistSnapshotToWatchPrefs(snapshotJson);
                        }
                    }
                }
            }
        }
    }

    private void persistSnapshotToWatchPrefs(String json) {
        try {
            JSONObject rootObj = new JSONObject(json);
            JSONObject obj = rootObj;
            if (rootObj.has("payload") && rootObj.optJSONObject("payload") != null) {
                obj = rootObj.optJSONObject("payload");
            }
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            boolean sessionActive = obj.optBoolean("sessionActive", rootObj.optBoolean("sessionActive", true));
            if (!sessionActive) {
                editor.putInt("arrowCount", 0);
                editor.putInt("totalScore", 0);
                editor.putInt("totalScoredArrows", 0);
                editor.putInt("currentEnd", 1);
            } else {
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
            }
            editor.apply();
        } catch (Exception ignored) {}
    }
}
