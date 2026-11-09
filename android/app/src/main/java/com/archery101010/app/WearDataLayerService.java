package com.archery101010.app;

import android.content.SharedPreferences;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataMap;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Background WearableListenerService on the Phone.
 * Ensures that even if Android suspends or kills MainActivity while the phone is locked
 * in the archer's pocket, Google Play Services wakes up this service on every watch
 * message or data change (/archery101010/*), updates the persistent session state,
 * replies immediately to watch pings/state requests, and queues commands for the WebView.
 */
public class WearDataLayerService extends WearableListenerService {
    private static final String WATCH_BRIDGE_PREFS = "archery_watch_bridge_prefs";

    @Override
    public void onMessageReceived(MessageEvent event) {
        super.onMessageReceived(event);
        if (event == null || event.getPath() == null) return;
        String path = event.getPath();
        if (!path.startsWith("/archery101010/")) return;

        String payload = event.getData() != null
            ? new String(event.getData(), StandardCharsets.UTF_8)
            : "";
        handleWatchEvent(path, payload, event.getSourceNodeId());
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
                    if ("/archery101010/watch_command".equals(path)) {
                        DataMap dataMap = DataMapItem.fromDataItem(item).getDataMap();
                        String cmdJson = dataMap.getString("command_json", "");
                        if (cmdJson != null && !cmdJson.isEmpty()) {
                            handleWatchEvent("/archery101010/command", cmdJson, "");
                        }
                    }
                }
            }
        }
    }

    private void handleWatchEvent(String path, String payload, String sourceNodeId) {
        MainActivity active = MainActivity.getActiveInstance();
        if (active != null) {
            active.onBackgroundWatchEvent(path, payload, sourceNodeId);
            return;
        }

        // Headless fallback when MainActivity is not in memory
        long now = System.currentTimeMillis();
        SharedPreferences prefs = getSharedPreferences(WATCH_BRIDGE_PREFS, MODE_PRIVATE);
        String savedSnapshot = prefs.getString("lastWatchSnapshotJson", "");

        if ("/archery101010/ping".equals(path)) {
            byte[] pongBytes = ("{\"type\":\"PONG\",\"_ts\":" + now + "}").getBytes(StandardCharsets.UTF_8);
            sendToNodeOrAll(sourceNodeId, "/archery101010/pong", pongBytes);
            if (savedSnapshot != null && !savedSnapshot.isEmpty()) {
                sendToNodeOrAll(sourceNodeId, "/archery101010/telemetry", savedSnapshot.getBytes(StandardCharsets.UTF_8));
            }
            return;
        }

        if ("/archery101010/pong".equals(path)) {
            prefs.edit().putLong("lastWatchPongTimeMs", now).apply();
            return;
        }

        if (payload == null || payload.isEmpty()) return;

        try {
            JSONObject cmdObj = new JSONObject(payload);
            String cmdType = cmdObj.optString("type", "");
            String cmdId = cmdObj.optString("_cmdId", "");
            long cmdSeq = cmdObj.optLong("_cmdSeq", 0L);

            if ("REQUEST_STATE".equals(cmdType)) {
                if (savedSnapshot != null && !savedSnapshot.isEmpty()) {
                    sendToNodeOrAll(sourceNodeId, "/archery101010/telemetry", savedSnapshot.getBytes(StandardCharsets.UTF_8));
                }
                return;
            }

            // Deduplicate against last processed command ID in SharedPreferences
            String lastCmdId = prefs.getString("lastProcessedWatchCmdId", "");
            if (!cmdId.isEmpty() && cmdId.equals(lastCmdId)) {
                return;
            }

            // Queue command in SharedPreferences so MainActivity flushes it to WebView on next resume
            String existingQueueStr = prefs.getString("pendingWatchCommandsJson", "[]");
            JSONArray queueArr;
            try {
                queueArr = new JSONArray(existingQueueStr);
            } catch (Exception e) {
                queueArr = new JSONArray();
            }
            if (queueArr.length() < 60) {
                queueArr.put(payload);
            }

            // Also update the cached snapshot state in SharedPreferences so watch gets instant ACK
            JSONObject state = (savedSnapshot != null && !savedSnapshot.isEmpty())
                ? new JSONObject(savedSnapshot)
                : new JSONObject();
            if (state.has("payload") && state.optJSONObject("payload") != null) {
                state = state.optJSONObject("payload");
            }
            if (cmdSeq > 0L) {
                state.put("_ackCmdSeq", cmdSeq);
            }
            state.put("updatedAt", now);

            if ("INCREMENT_ARROW".equals(cmdType)) {
                int delta = cmdObj.optInt("delta", 1);
                state.put("arrowsCount", Math.max(0, state.optInt("arrowsCount", 0) + delta));
                state.put("sessionActive", true);
            } else if ("DECREMENT_ARROW".equals(cmdType) || "UNDO_ARROW".equals(cmdType)) {
                state.put("arrowsCount", Math.max(0, state.optInt("arrowsCount", 0) - 1));
            } else if ("FINISH_SESSION_FROM_WATCH".equals(cmdType)) {
                state.put("sessionActive", false);
                state.put("arrowsCount", 0);
                state.put("totalScore", 0);
            }

            String updatedSnapshot = state.toString();
            prefs.edit()
                .putString("lastProcessedWatchCmdId", cmdId)
                .putString("pendingWatchCommandsJson", queueArr.toString())
                .putString("lastWatchSnapshotJson", updatedSnapshot)
                .putLong("lastWatchSnapshotTimeMs", now)
                .apply();

            PutDataMapRequest putDataMapReq = PutDataMapRequest.create("/archery101010/state");
            putDataMapReq.getDataMap().putString("snapshot_json", updatedSnapshot);
            putDataMapReq.getDataMap().putLong("updated_at", now);
            PutDataRequest putDataReq = putDataMapReq.asPutDataRequest().setUrgent();
            Wearable.getDataClient(this).putDataItem(putDataReq);
        } catch (Exception ignored) {}
    }

    private void sendToNodeOrAll(String sourceNodeId, String path, byte[] data) {
        try {
            if (sourceNodeId != null && !sourceNodeId.isEmpty()) {
                Wearable.getMessageClient(this).sendMessage(sourceNodeId, path, data);
                return;
            }
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                if (nodes != null) {
                    for (Node node : nodes) {
                        Wearable.getMessageClient(this).sendMessage(node.getId(), path, data);
                    }
                }
            });
        } catch (Exception ignored) {}
    }
}
