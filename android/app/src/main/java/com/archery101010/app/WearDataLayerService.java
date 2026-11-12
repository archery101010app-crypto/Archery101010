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
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;
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
    private static final int MAX_RECENT_CMD_IDS = 50;
    private static final Set<String> recentProcessedCmdIds = new LinkedHashSet<>();
    private static boolean recentIdsLoadedFromPrefs = false;

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

    private int scorePointsFromLabel(final String label) {
        if ("X".equalsIgnoreCase(label) || "10".equals(label)) return 10;
        if ("M".equalsIgnoreCase(label) || label == null || label.isEmpty()) return 0;
        try {
            int val = Integer.parseInt(label.trim());
            return Math.max(0, Math.min(10, val));
        } catch (Exception e) {
            return 0;
        }
    }

    private boolean isDuplicateAndRecordCmdId(final String cmdId, final SharedPreferences prefs) {
        if (cmdId == null || cmdId.isEmpty()) return false;
        synchronized (recentProcessedCmdIds) {
            if (!recentIdsLoadedFromPrefs) {
                recentIdsLoadedFromPrefs = true;
                try {
                    String rawArr = prefs.getString("recentProcessedWatchCmdIdsJson", "[]");
                    JSONArray arr = new JSONArray(rawArr);
                    for (int i = 0; i < arr.length(); i++) {
                        String id = arr.optString(i, "");
                        if (id != null && !id.isEmpty()) {
                            recentProcessedCmdIds.add(id);
                        }
                    }
                } catch (Exception ignored) {}
                String legacySingle = prefs.getString("lastProcessedWatchCmdId", "");
                if (legacySingle != null && !legacySingle.isEmpty()) {
                    recentProcessedCmdIds.add(legacySingle);
                }
                while (recentProcessedCmdIds.size() > MAX_RECENT_CMD_IDS) {
                    Iterator<String> it = recentProcessedCmdIds.iterator();
                    if (it.hasNext()) {
                        it.next();
                        it.remove();
                    }
                }
            }
            if (recentProcessedCmdIds.contains(cmdId)) {
                return true;
            }
            recentProcessedCmdIds.add(cmdId);
            while (recentProcessedCmdIds.size() > MAX_RECENT_CMD_IDS) {
                Iterator<String> it = recentProcessedCmdIds.iterator();
                if (it.hasNext()) {
                    it.next();
                    it.remove();
                }
            }
        }
        return false;
    }

    private String serializeRecentCmdIds() {
        synchronized (recentProcessedCmdIds) {
            JSONArray arr = new JSONArray();
            for (String id : recentProcessedCmdIds) {
                arr.put(id);
            }
            return arr.toString();
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
            String cmdId = cmdObj.optString("_cmdId", cmdObj.optString("cmdId", ""));
            long cmdSeq = cmdObj.optLong("_cmdSeq", cmdObj.optLong("cmdSeq", 0L));

            if ("REQUEST_STATE".equals(cmdType)) {
                if (savedSnapshot != null && !savedSnapshot.isEmpty()) {
                    sendToNodeOrAll(sourceNodeId, "/archery101010/telemetry", savedSnapshot.getBytes(StandardCharsets.UTF_8));
                }
                return;
            }

            // Bounded LinkedHashSet deduplication across interleaved MessageClient + DataClient deliveries
            if (isDuplicateAndRecordCmdId(cmdId, prefs)) {
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
            if (queueArr.length() < 100) {
                queueArr.put(payload);
            }

            // Update the cached snapshot state in SharedPreferences so watch gets accurate instant ACK
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

            int arrowsPerEnd = Math.max(1, state.optInt("arrowsPerEnd", 6));
            int endsCount = Math.max(1, state.optInt("endsCount", 12));
            int curEndIdx = Math.max(0, state.optInt("currentEndIndex", 0));
            JSONArray curEndArrows = state.optJSONArray("currentEndArrows");
            if (curEndArrows == null) {
                curEndArrows = new JSONArray();
            }

            if ("INCREMENT_ARROW".equals(cmdType)) {
                int delta = cmdObj.optInt("delta", 1);
                state.put("arrowsCount", Math.max(0, state.optInt("arrowsCount", 0) + delta));
                state.put("sessionActive", true);
                // Physical watch counter never injects fake "10" scores into scorecard ends (scores come strictly from SCORE_INPUT)
            } else if ("DECREMENT_ARROW".equals(cmdType) || "UNDO_ARROW".equals(cmdType)) {
                state.put("arrowsCount", Math.max(0, state.optInt("arrowsCount", 0) - 1));
                JSONObject payloadObj = cmdObj.optJSONObject("payload");
                int explicitTotal = cmdObj.has("totalScore")
                    ? cmdObj.optInt("totalScore", -1)
                    : (payloadObj != null && payloadObj.has("totalScore") ? payloadObj.optInt("totalScore", -1) : -1);
                if (curEndArrows.length() > 0) {
                    String removed = curEndArrows.optString(curEndArrows.length() - 1, "");
                    JSONArray trimmed = new JSONArray();
                    for (int i = 0; i < curEndArrows.length() - 1; i++) {
                        trimmed.put(curEndArrows.optString(i, ""));
                    }
                    curEndArrows = trimmed;
                    state.put("currentEndArrows", curEndArrows);
                    if (explicitTotal < 0) {
                        int pts = scorePointsFromLabel(removed);
                        state.put("totalScore", Math.max(0, state.optInt("totalScore", 0) - pts));
                    }
                }
                if (explicitTotal >= 0) {
                    state.put("totalScore", explicitTotal);
                }
            } else if ("SCORE_INPUT".equals(cmdType)) {
                JSONObject payloadObj = cmdObj.optJSONObject("payload");
                String val = payloadObj != null && payloadObj.has("value")
                    ? payloadObj.optString("value", "")
                    : cmdObj.optString("value", "");
                if (!val.isEmpty()) {
                    if (curEndArrows.length() >= arrowsPerEnd) {
                        if (curEndIdx < endsCount - 1) {
                            curEndIdx++;
                            curEndArrows = new JSONArray();
                        }
                    }
                    if (curEndArrows.length() < arrowsPerEnd) {
                        curEndArrows.put(val);
                    }
                    state.put("currentEndIndex", curEndIdx);
                    state.put("currentEndArrows", curEndArrows);
                    state.put("arrowsCount", Math.max(0, state.optInt("arrowsCount", 0) + 1));
                    state.put("sessionActive", true);

                    int pts = scorePointsFromLabel(val);
                    int incomingTotal = payloadObj != null && payloadObj.has("totalScore")
                        ? payloadObj.optInt("totalScore", -1)
                        : (cmdObj.has("totalScore") ? cmdObj.optInt("totalScore", -1) : -1);
                    if (incomingTotal >= 0) {
                        state.put("totalScore", incomingTotal);
                    } else {
                        state.put("totalScore", Math.max(0, state.optInt("totalScore", 0) + pts));
                    }
                }
            } else if ("NEXT_END".equals(cmdType)) {
                if (curEndIdx < endsCount - 1) {
                    state.put("currentEndIndex", curEndIdx + 1);
                    state.put("currentEndArrows", new JSONArray());
                }
            } else if ("SYNC_TELEMETRY_FROM_WATCH".equals(cmdType)) {
                JSONObject payloadObj = cmdObj.optJSONObject("payload");
                int steps = payloadObj != null
                    ? payloadObj.optInt("stepsCount", state.optInt("stepsCount", 0))
                    : cmdObj.optInt("stepsCount", state.optInt("stepsCount", 0));
                int walkedM = payloadObj != null
                    ? payloadObj.optInt("distanceWalkedM", state.optInt("distanceWalkedM", 0))
                    : cmdObj.optInt("distanceWalkedM", state.optInt("distanceWalkedM", 0));
                state.put("stepsCount", Math.max(state.optInt("stepsCount", 0), steps));
                state.put("distanceWalkedM", Math.max(state.optInt("distanceWalkedM", 0), walkedM));
            } else if ("TOGGLE_AUTO_DETECT".equals(cmdType)) {
                state.put("autoDetectEnabled", cmdObj.optBoolean("enabled", true));
            } else if ("FINISH_SESSION_FROM_WATCH".equals(cmdType)) {
                state.put("sessionActive", false);
                state.put("arrowsCount", 0);
                state.put("totalScore", 0);
                state.put("currentEndIndex", 0);
                state.put("currentEndArrows", new JSONArray());
                state.put("completedEnds", 0);
            }

            String updatedSnapshot = state.toString();
            prefs.edit()
                .putString("lastProcessedWatchCmdId", cmdId)
                .putString("recentProcessedWatchCmdIdsJson", serializeRecentCmdIds())
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
