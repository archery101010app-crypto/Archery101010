package com.archery101010.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.ExifInterface;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Keep;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
import androidx.wear.remote.interactions.RemoteActivityHelper;
import com.spotify.android.appremote.api.ConnectionParams;
import com.spotify.android.appremote.api.Connector;
import com.spotify.android.appremote.api.SpotifyAppRemote;
import com.spotify.protocol.types.PlayerState;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataMap;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@Keep
public class MainActivity extends BridgeActivity {
    private static volatile WeakReference<MainActivity> activeInstanceRef = new WeakReference<>(null);

    @Keep
    public static MainActivity getActiveInstance() {
        return activeInstanceRef != null ? activeInstanceRef.get() : null;
    }

    @Keep
    public void onBackgroundWatchEvent(final String path, final String payload, final String sourceNodeId) {
        handleIncomingWatchPayload(path, payload, sourceNodeId);
    }

    private static final String GOOGLE_WEB_CLIENT_ID =
        "757910399585-q71dprgcodk5s2t67965gdfusr1lv441.apps.googleusercontent.com";
    private static final String WATCH_BRIDGE_PREFS = "archery_watch_bridge_prefs";
    private static final String SPOTIFY_PREFS = "archery_spotify_prefs";
    private static final String BLE_HR_PREFS = "archery_ble_hr_prefs";

    private ActivityResultLauncher<Intent> googleSignInLauncher;
    private ActivityResultLauncher<String[]> locationPermissionLauncher;
    private ActivityResultLauncher<String[]> blePermissionLauncher;
    private ActivityResultLauncher<Intent> bleEnableLauncher;
    private ActivityResultLauncher<String> audioPermissionLauncher;
    private ActivityResultLauncher<Intent> cameraCaptureLauncher;
    private PermissionRequest pendingWebAudioPermissionRequest = null;
    private File pendingCameraCaptureFile = null;
    private volatile String activeAppOrigin = "https://localhost";
    private volatile boolean isWebWatchListenerReady = false;
    private volatile boolean pendingClearHistoryAfterOta = false;
    private final Handler otaWatchdogHandler = new Handler(Looper.getMainLooper());
    private Runnable otaWatchdogRunnable = null;

    private boolean hasActiveNetworkConnection() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            Network activeNet = cm.getActiveNetwork();
            if (activeNet == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(activeNet);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception ignored) {
            return false;
        }
    }

    private void cancelOtaWatchdog() {
        if (otaWatchdogRunnable != null) {
            otaWatchdogHandler.removeCallbacks(otaWatchdogRunnable);
            otaWatchdogRunnable = null;
        }
    }

    private void scheduleOtaWatchdog(final WebView webView) {
        cancelOtaWatchdog();
        otaWatchdogRunnable = () -> {
            otaWatchdogRunnable = null;
            if (webView != null && !"https://localhost".equals(activeAppOrigin)) {
                pendingClearHistoryAfterOta = false;
                activeAppOrigin = "https://localhost";
                try {
                    webView.stopLoading();
                } catch (Exception ignored) {}
                webView.loadUrl("https://localhost/");
            }
        };
        otaWatchdogHandler.postDelayed(otaWatchdogRunnable, 8000L);
    }

    // Native Live Session GPS + Movement Tracker (active ONLY during an active training session)
    private volatile boolean isSessionTrackingActive = false;
    private volatile double initialSessionMeters = 0.0;
    private volatile double sessionAccumulatedMeters = 0.0;
    private volatile double accumulatedGpsDistanceM = 0.0;
    private volatile int accumulatedSteps = 0;
    private volatile boolean hasGpsFix = false;
    private Location lastValidGpsLocation = null;
    private long lastGpsFixTimeMs = 0L;
    private long lastHighAccuracyGpsTimeMs = 0L;
    private long lastStepDetectedTimeMs = 0L;
    private LocationManager nativeLocationManager = null;
    private SensorManager nativeSensorManager = null;
    private Sensor nativeAccelerometer = null;
    private MessageClient.OnMessageReceivedListener wearMessageListener = null;
    private DataClient.OnDataChangedListener wearDataListener = null;

    // Native Wear OS Dual-Channel State Cache & Command Queue (works even when phone screen is off)
    private volatile String lastWatchSnapshotJson = "";
    private volatile long lastWatchMessageTimeMs = 0L;
    private volatile long lastWatchPongTimeMs = 0L;
    private volatile long lastWatchCmdSeq = 0L;
    private final List<String> pendingWatchCommands = new ArrayList<>();
    private final Set<String> processedWatchCmdIds = new LinkedHashSet<>();
    private volatile JSONArray cachedConnectedNodesJson = new JSONArray();
    // Node IDs of paired watches that already advertise the Wear OS app capability (archery101010_watch_app)
    private volatile Set<String> cachedWatchNodesWithApp = new LinkedHashSet<>();
    private static final String WEAR_APP_CAPABILITY = "archery101010_watch_app";

    private final LocationListener nativeLocationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location loc) {
            if (!isSessionTrackingActive || loc == null) return;
            // Strict satellite-grade accuracy gate (<= 14m) so indoor Wi-Fi/cell triangulation bounce never adds phantom meters
            if (!loc.hasAccuracy() || loc.getAccuracy() > 14f) {
                return;
            }
            long now = System.currentTimeMillis();
            if (lastValidGpsLocation != null) {
                float deltaM = loc.distanceTo(lastValidGpsLocation);
                long dtMs = Math.max(500L, now - lastGpsFixTimeMs);
                float speedMs = (deltaM * 1000f) / dtMs;
                if (deltaM > 60f || speedMs > 5.5f) {
                    lastValidGpsLocation = loc;
                    lastGpsFixTimeMs = now;
                    hasGpsFix = true;
                    return;
                }
                float minDeltaM = Math.max(8.0f, loc.getAccuracy() * 1.25f);
                if (deltaM >= minDeltaM) {
                    if (speedMs >= 0.55f) {
                        accumulatedGpsDistanceM += deltaM;
                        sessionAccumulatedMeters = Math.max(accumulatedGpsDistanceM, accumulatedSteps * 0.76);
                        emitLocationSnapshot();
                    }
                    lastValidGpsLocation = loc;
                    lastGpsFixTimeMs = now;
                    hasGpsFix = true;
                }
            } else {
                lastValidGpsLocation = loc;
                lastGpsFixTimeMs = now;
                hasGpsFix = true;
                emitLocationSnapshot();
            }
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {}

        @Override
        public void onProviderEnabled(String provider) {}

        @Override
        public void onProviderDisabled(String provider) {}
    };

    private final SensorEventListener nativeStepSensorListener = new SensorEventListener() {
        private double gravityMag = 9.81;
        private double smoothLin = 0.0;
        private boolean armedForPeak = true;
        private boolean peakSeen = false;
        private final long[] candidateTimes = new long[6];
        private int candidateCount = 0;
        private boolean rhythmicActive = false;

        @Override
        public void onSensorChanged(SensorEvent event) {
            if (!isSessionTrackingActive || event == null || event.values == null) return;
            float ax = event.values[0];
            float ay = event.values[1];
            float az = event.values[2];
            double mag = Math.sqrt(ax * ax + ay * ay + az * az);
            gravityMag = 0.94 * gravityMag + 0.06 * mag;
            smoothLin = 0.65 * smoothLin + 0.35 * (mag - gravityMag);
            long now = System.currentTimeMillis();

            long lastMs = candidateCount > 0 ? candidateTimes[(candidateCount - 1) % 6] : 0L;
            if (lastMs > 0L && (now - lastMs) > 1500L) {
                candidateCount = 0;
                rhythmicActive = false;
                peakSeen = false;
                armedForPeak = true;
            }

            if (armedForPeak && smoothLin >= 1.85) {
                peakSeen = true;
                armedForPeak = false;
            } else if (peakSeen && smoothLin <= -0.80) {
                peakSeen = false;
                armedForPeak = true;
                if (lastMs > 0L) {
                    long dt = now - lastMs;
                    if (dt < 360L) return;
                    if (dt > 950L) {
                        candidateTimes[0] = now;
                        candidateCount = 1;
                        rhythmicActive = false;
                        return;
                    }
                }
                candidateTimes[candidateCount % 6] = now;
                candidateCount++;
                if (rhythmicActive) {
                    lastStepDetectedTimeMs = now;
                    accumulatedSteps += 1;
                    sessionAccumulatedMeters = Math.max(accumulatedGpsDistanceM, accumulatedSteps * 0.76);
                    emitLocationSnapshot();
                    return;
                }
                if (candidateCount >= 6) {
                    double sumIv = 0.0;
                    long[] ivs = new long[5];
                    for (int i = 0; i < 5; i++) {
                        long tB = candidateTimes[(candidateCount - 1 - i) % 6];
                        long tA = candidateTimes[(candidateCount - 2 - i) % 6];
                        ivs[i] = tB - tA;
                        if (ivs[i] < 360L || ivs[i] > 950L) return;
                        sumIv += ivs[i];
                    }
                    double meanIv = sumIv / 5.0;
                    for (int i = 0; i < 5; i++) {
                        if (Math.abs(ivs[i] - meanIv) > meanIv * 0.24) return;
                    }
                    rhythmicActive = true;
                    lastStepDetectedTimeMs = now;
                    accumulatedSteps += 6;
                    sessionAccumulatedMeters = Math.max(accumulatedGpsDistanceM, accumulatedSteps * 0.76);
                    emitLocationSnapshot();
                }
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        googleSignInLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                Intent data = result.getData();
                Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
                try {
                    GoogleSignInAccount account = task.getResult(ApiException.class);
                    sendAccountSuccess(account);
                } catch (ApiException e) {
                    int code = e.getStatusCode();
                    if (code == 12501 || code == 16) {
                        sendAccountError(code, "Cancelado");
                        return;
                    }
                    // Code 10 / 12500 / network errors: report to JS, which launches the Web OAuth 2.0
                    // id_token flow with a verified nonce. Never persist a permanent preference: a transient
                    // failure must not disable the native account picker forever.
                    sendAccountError(code, "Native Google Sign-In failed");
                } catch (Exception ex) {
                    sendAccountError(-1, ex.getMessage());
                }
            }
        );

        locationPermissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            result -> {
                if (isSessionTrackingActive) {
                    bindNativeGpsProviders();
                }
            }
        );

        blePermissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            result -> {
                if (hasBlePermissionsInternal()) {
                    if (pendingBleActionAfterPermission == 2 && pendingBleConnectAddress != null) {
                        String addr = pendingBleConnectAddress;
                        String name = pendingBleConnectName;
                        pendingBleActionAfterPermission = 0;
                        connectBleHrDeviceInternal(addr, name, false);
                    } else {
                        pendingBleActionAfterPermission = 0;
                        startBleHrScanInternal();
                    }
                } else {
                    pendingBleActionAfterPermission = 0;
                    bleHrState = "error";
                    bleHrErrorCode = "PERMISSION_DENIED";
                    emitBleHrStatusToWebView(null);
                }
            }
        );

        bleEnableLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                BluetoothAdapter adapter = getBleAdapterInternal();
                if (adapter != null && adapter.isEnabled()) {
                    startBleHrScanInternal();
                } else {
                    bleHrState = "error";
                    bleHrErrorCode = "BLUETOOTH_OFF";
                    emitBleHrStatusToWebView(null);
                }
            }
        );

        cameraCaptureLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == RESULT_OK) {
                    new Thread(() -> {
                        processCapturedCameraPhoto(result.getData());
                    }).start();
                }
            }
        );

        audioPermissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            isGranted -> {
                final PermissionRequest req = pendingWebAudioPermissionRequest;
                pendingWebAudioPermissionRequest = null;
                if (req == null) return;
                runOnUiThread(() -> {
                    try {
                        if (Boolean.TRUE.equals(isGranted)) {
                            req.grant(req.getResources());
                        } else {
                            req.deny();
                        }
                    } catch (Exception ignored) {}
                });
            }
        );

        super.onCreate(savedInstanceState);
        activeInstanceRef = new WeakReference<>(this);

        // Configure WebView for Native Google Account Picker, OAuth, Spotify playback, and session cookies
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
            WebSettings settings = webView.getSettings();
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
            settings.setGeolocationEnabled(true);
            String defaultUa = settings.getUserAgentString();
            if (defaultUa != null) {
                String cleanUa = defaultUa.replace("; wv", "").replace("Version/4.0 ", "");
                settings.setUserAgentString(cleanUa);
            }

            final ArcheryNativeShare nativeShareBridge = new ArcheryNativeShare();
            webView.addJavascriptInterface(new ArcheryNativeAuth(), "ArcheryNativeAuth");
            webView.addJavascriptInterface(nativeShareBridge, "ArcheryNativeShare");
            webView.addJavascriptInterface(new ArcheryWatchNativeBridge(), "ArcheryWatchNativeBridge");
            webView.addJavascriptInterface(new ArcheryLocationNativeBridge(), "ArcheryLocationNativeBridge");
            webView.addJavascriptInterface(new ArcherySpotifyBridge(), "ArcherySpotifyBridge");
            webView.addJavascriptInterface(new ArcheryBleHeartRateBridge(), "ArcheryBleHeartRateBridge");
            initWearableListener();

            if (getSharedPreferences("archery_ota_prefs", MODE_PRIVATE).getBoolean("prefer_remote_ota", false)
                    && hasActiveNetworkConnection()) {
                activeAppOrigin = "https://archery101010-c0bb4.web.app";
                pendingClearHistoryAfterOta = true;
                scheduleOtaWatchdog(webView);
                java.util.Map<String, String> otaStartupHeaders = new java.util.HashMap<>();
                otaStartupHeaders.put("Cache-Control", "no-cache");
                webView.loadUrl("https://archery101010-c0bb4.web.app/", otaStartupHeaders);
            }

            // Subclass Capacitor's BridgeWebChromeClient so <input type="file"> (Excel/Photos) keeps working 100%
            // while granting WebRTC RECORD_AUDIO requests cleanly via ActivityResultContracts.RequestPermission
            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    if (request == null) return;
                    String[] resources = request.getResources();
                    boolean wantsAudio = false;
                    boolean wantsVideo = false;
                    if (resources != null) {
                        for (String res : resources) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                                wantsAudio = true;
                            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                                wantsVideo = true;
                            }
                        }
                    }
                    if (wantsAudio && !wantsVideo) {
                        runOnUiThread(() -> {
                            try {
                                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                                        == PackageManager.PERMISSION_GRANTED) {
                                    request.grant(resources);
                                } else if (audioPermissionLauncher != null) {
                                    pendingWebAudioPermissionRequest = request;
                                    audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO);
                                } else {
                                    super.onPermissionRequest(request);
                                }
                            } catch (Exception ignored) {}
                        });
                        return;
                    }
                    super.onPermissionRequest(request);
                }
            });

            // Handle standard HTTP/HTTPS downloadable files and data: URIs from WebView
            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                if (url == null || url.isEmpty()) return;
                if (url.startsWith("data:")) {
                    int comma = url.indexOf(',');
                    if (comma > 0) {
                        String meta = url.substring(5, comma);
                        String dataPart = url.substring(comma + 1);
                        String resolvedMime = (mimetype != null && !mimetype.isEmpty()) ? mimetype : "application/octet-stream";
                        int semi = meta.indexOf(';');
                        if (semi > 0) {
                            resolvedMime = meta.substring(0, semi);
                        }
                        if (meta.contains("base64")) {
                            nativeShareBridge.saveOrShareFile(dataPart, "Archery101010-Export", resolvedMime, "Exportar archivo");
                        }
                    }
                    return;
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    try {
                        Uri dlUri = Uri.parse(url);
                        if (dlUri != null && "archery101010-c0bb4.web.app".equalsIgnoreCase(dlUri.getHost())) {
                            dlUri = dlUri.buildUpon().authority("archery101010-c0bb4.firebaseapp.com").build();
                        }
                        Intent dlIntent = new Intent(Intent.ACTION_VIEW, dlUri);
                        dlIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(dlIntent);
                    } catch (Exception ignored) {}
                }
            });

            getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    if (url != null && (url.startsWith("https://localhost") || url.startsWith("https://archery101010-c0bb4.web.app"))) {
                        isWebWatchListenerReady = false;
                        try {
                            view.evaluateJavascript(
                                "(function(){try{if(typeof Node==='function'&&Node.prototype&&!Node.prototype.__archeryDomPatched){var r=Node.prototype.removeChild,i=Node.prototype.insertBefore;Node.prototype.removeChild=function(c){if(c&&c.parentNode!==this){var p=c.parentNode;if(p){var out=r.call(p,c),cur=p;while(cur&&cur!==this&&cur.nodeName==='FONT'&&cur.childNodes.length===0&&cur.parentNode){var np=cur.parentNode;r.call(np,cur);cur=np;}return out;}return c;}return r.call(this,c);};Node.prototype.insertBefore=function(n,ref){if(ref&&ref.parentNode!==this){var a=ref.parentNode;while(a&&a.parentNode!==this){a=a.parentNode;}if(a&&a.parentNode===this){return i.call(this,n,a);}return i.call(this,n,null);}return i.call(this,n,ref);};Object.defineProperty(Node.prototype,'__archeryDomPatched',{value:true,configurable:true});}}catch(e){}})();",
                                null
                            );
                        } catch (Exception ignored) {}
                    }
                    super.onPageStarted(view, url, favicon);
                }

                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    super.onPageCommitVisible(view, url);
                    if (url != null && url.contains("archery101010-c0bb4.web.app")) {
                        cancelOtaWatchdog();
                    }
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (url != null && url.contains("archery101010-c0bb4.web.app")) {
                        cancelOtaWatchdog();
                        if (pendingClearHistoryAfterOta && view != null) {
                            pendingClearHistoryAfterOta = false;
                            view.clearHistory();
                        }
                    }
                    flushPendingWatchCommandsToWebView();
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                    if (request != null && request.isForMainFrame() && request.getUrl() != null) {
                        String host = request.getUrl().getHost();
                        if (host != null && host.contains("archery101010-c0bb4.web.app")) {
                            cancelOtaWatchdog();
                            pendingClearHistoryAfterOta = false;
                            activeAppOrigin = "https://localhost";
                            view.loadUrl("https://localhost/");
                            return;
                        }
                    }
                    super.onReceivedError(view, request, error);
                }

                @Override
                public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                    if (request != null && request.isForMainFrame() && errorResponse != null && errorResponse.getStatusCode() >= 500 && request.getUrl() != null) {
                        String host = request.getUrl().getHost();
                        if (host != null && host.contains("archery101010-c0bb4.web.app")) {
                            cancelOtaWatchdog();
                            pendingClearHistoryAfterOta = false;
                            activeAppOrigin = "https://localhost";
                            view.loadUrl("https://localhost/");
                            return;
                        }
                    }
                    super.onReceivedHttpError(view, request, errorResponse);
                }

                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if (uri != null) {
                        String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
                        String path = uri.getPath() != null ? uri.getPath() : "";
                        if (request.isForMainFrame() && !path.startsWith("/__/auth/handler")) {
                            if (host.equals("localhost")) {
                                activeAppOrigin = "https://localhost";
                            } else if (host.equals("archery101010-c0bb4.web.app")) {
                                activeAppOrigin = "https://archery101010-c0bb4.web.app";
                                getSharedPreferences("archery_ota_prefs", MODE_PRIVATE)
                                    .edit()
                                    .putBoolean("prefer_remote_ota", true)
                                    .apply();
                            }
                        }
                        String urlStr = uri.toString();
                        if (urlStr.startsWith("https://archery101010-c0bb4.firebaseapp.com/__/auth/handler") ||
                            urlStr.startsWith("https://archery101010-c0bb4.web.app/__/auth/handler")) {
                            String targetOrigin = activeAppOrigin != null ? activeAppOrigin : "https://localhost";
                            String html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script>" +
                                "window.location.replace('" + targetOrigin + "/' + window.location.search + window.location.hash);" +
                                "</script></head><body style=\"background:#050505\"></body></html>";
                            return new WebResourceResponse(
                                "text/html",
                                "UTF-8",
                                new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8))
                            );
                        }
                        // Let Chromium's native HTTP/3 stack fetch remote OTA assets directly without WebViewLocalServer proxy
                        if (host.equals("archery101010-c0bb4.web.app")) {
                            return null;
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if (uri != null) {
                        String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                        String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
                        String path = uri.getPath() != null ? uri.getPath() : "";
                        if (scheme.equals("spotify") ||
                            scheme.equals("market") ||
                            scheme.equals("whatsapp") ||
                            scheme.equals("mailto") ||
                            scheme.equals("tel") ||
                            host.equals("api.whatsapp.com") ||
                            host.equals("wa.me") ||
                            host.equals("play.google.com")) {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                                return true;
                            } catch (Exception ignored) {
                                return true;
                            }
                        }
                        if (!host.isEmpty()) {
                            String lowerPath = path.toLowerCase();
                            boolean isDirectDownloadAsset =
                                lowerPath.endsWith(".apk") ||
                                lowerPath.endsWith(".aab") ||
                                lowerPath.endsWith(".iq") ||
                                lowerPath.endsWith(".pdf") ||
                                lowerPath.endsWith(".csv") ||
                                lowerPath.equals("/wear-aab") ||
                                lowerPath.equals("/wear-apk") ||
                                lowerPath.equals("/phone-aab") ||
                                lowerPath.equals("/garmin-iq") ||
                                lowerPath.equals("/download-apk") ||
                                lowerPath.equals("/download-aab");
                            if (host.equals("archery101010-c0bb4.web.app") && isDirectDownloadAsset) {
                                try {
                                    Uri safeDlUri = uri.buildUpon().authority("archery101010-c0bb4.firebaseapp.com").build();
                                    Intent intent = new Intent(Intent.ACTION_VIEW, safeDlUri);
                                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(intent);
                                    return true;
                                } catch (Exception ignored) {}
                            }
                            boolean isTrustedAppOrAuthHost =
                                host.equals("localhost") ||
                                host.equals("127.0.0.1") ||
                                host.equals("archery101010-c0bb4.web.app") ||
                                host.equals("archery101010-c0bb4.firebaseapp.com") ||
                                host.equals("accounts.google.com") ||
                                host.endsWith(".google.com") ||
                                host.endsWith(".googleusercontent.com") ||
                                host.equals("accounts.youtube.com");

                            if (request.isForMainFrame()) {
                                if (isTrustedAppOrAuthHost) {
                                    return false;
                                }
                                // Keep the privileged @JavascriptInterface WebView strictly on app origins;
                                // open external third-party domains (open.spotify.com, youtube.com, etc.) externally.
                                if ("http".equals(scheme) || "https".equals(scheme)) {
                                    try {
                                        Intent extIntent = new Intent(Intent.ACTION_VIEW, uri);
                                        extIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                        startActivity(extIntent);
                                        return true;
                                    } catch (Exception ignored) {
                                        return true;
                                    }
                                }
                            } else if ("http".equals(scheme) || "https".equals(scheme)) {
                                return false;
                            }
                        }
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }
            });
        }

        // Ensure Android WebView respects system window insets (status bar, navigation bar, cutouts) once without duplicating into CSS env(safe-area-inset-*)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (view, insets) -> {
            androidx.core.graphics.Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    private void sendAccountSuccess(GoogleSignInAccount account) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("success", true);
            payload.put("idToken", account != null && account.getIdToken() != null ? account.getIdToken() : "");
            payload.put("email", account != null && account.getEmail() != null ? account.getEmail() : "");
            payload.put("displayName", account != null && account.getDisplayName() != null ? account.getDisplayName() : "");
            payload.put("googleId", account != null && account.getId() != null ? account.getId() : "");
            dispatchGoogleResultToWebView(payload.toString());
        } catch (Exception ignored) {}
    }

    private void sendAccountError(int statusCode, String message) {
        try {
            JSONObject errPayload = new JSONObject();
            errPayload.put("success", false);
            errPayload.put("statusCode", statusCode);
            errPayload.put("error", message != null ? message : "Google Sign-In error");
            dispatchGoogleResultToWebView(errPayload.toString());
        } catch (Exception ignored) {}
    }

    private void dispatchGoogleResultToWebView(final String jsonPayload) {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = "if (window.__onNativeGoogleSignIn) { window.__onNativeGoogleSignIn(" + jsonPayload + "); }";
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private void launchWebGoogleOAuthFallback() {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String nonce = Long.toString(System.currentTimeMillis(), 36);
                String oauthUrl =
                    "https://accounts.google.com/o/oauth2/v2/auth" +
                    "?client_id=" + Uri.encode(GOOGLE_WEB_CLIENT_ID) +
                    "&redirect_uri=" + Uri.encode("https://archery101010-c0bb4.firebaseapp.com/__/auth/handler") +
                    "&response_type=id_token" +
                    "&scope=" + Uri.encode("openid email profile") +
                    "&nonce=" + Uri.encode(nonce) +
                    "&prompt=select_account";
                getBridge().getWebView().loadUrl(oauthUrl);
            }
        });
    }

    @Keep
    public class ArcheryNativeAuth {
        @Keep
        @JavascriptInterface
        public void startGoogleSignIn() {
            runOnUiThread(() -> {
                try {
                    // Clear any legacy "prefer_web_oauth" flag left by older builds
                    getSharedPreferences("archery_auth_prefs", MODE_PRIVATE).edit().remove("prefer_web_oauth").apply();
                    GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                        .requestIdToken(GOOGLE_WEB_CLIENT_ID)
                        .requestEmail()
                        .requestProfile()
                        .build();
                    GoogleSignInClient client = GoogleSignIn.getClient(MainActivity.this, gso);
                    client.signOut().addOnCompleteListener(task -> {
                        googleSignInLauncher.launch(client.getSignInIntent());
                    });
                } catch (Exception e) {
                    sendAccountError(-1, e.getMessage());
                }
            });
        }

        @Keep
        @JavascriptInterface
        public String getShellVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception ignored) {
                return "";
            }
        }

        @Keep
        @JavascriptInterface
        public void saveCrossOriginMigrationSnapshot(final String jsonPayload) {
            try {
                getSharedPreferences("archery_ota_prefs", MODE_PRIVATE)
                    .edit()
                    .putString("pending_origin_migration_json", jsonPayload != null ? jsonPayload : "")
                    .commit();
            } catch (Exception ignored) {}
        }

        @Keep
        @JavascriptInterface
        public String consumeCrossOriginMigrationSnapshot() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("archery_ota_prefs", MODE_PRIVATE);
                String payload = prefs.getString("pending_origin_migration_json", "");
                if (payload != null && !payload.isEmpty()) {
                    prefs.edit().remove("pending_origin_migration_json").apply();
                    return payload;
                }
                return "";
            } catch (Exception ignored) {
                return "";
            }
        }

        @Keep
        @JavascriptInterface
        public void reloadInAppOta() {
            runOnUiThread(() -> {
                try {
                    getSharedPreferences("archery_ota_prefs", MODE_PRIVATE)
                        .edit()
                        .putBoolean("prefer_remote_ota", true)
                        .apply();
                    activeAppOrigin = "https://archery101010-c0bb4.web.app";
                    pendingClearHistoryAfterOta = true;
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        WebView wv = getBridge().getWebView();
                        scheduleOtaWatchdog(wv);
                        wv.clearCache(true);
                        java.util.Map<String, String> otaHeaders = new java.util.HashMap<>();
                        otaHeaders.put("Cache-Control", "no-cache, no-store, must-revalidate");
                        otaHeaders.put("Pragma", "no-cache");
                        wv.loadUrl("https://archery101010-c0bb4.web.app/?ota=" + System.currentTimeMillis(), otaHeaders);
                    }
                } catch (Exception ignored) {}
            });
        }
    }

    @Keep
    public class ArcheryNativeShare {
        private Uri writeBase64PngToCache(String base64Png, String fileName) throws Exception {
            String cleanBase64 = base64Png;
            int commaIdx = cleanBase64.indexOf(',');
            if (commaIdx != -1) {
                cleanBase64 = cleanBase64.substring(commaIdx + 1);
            }
            byte[] imageBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
            String safeName = (fileName != null && !fileName.isEmpty()) ? fileName : ("Archery101010-" + System.currentTimeMillis() + ".png");
            File outFile = new File(getCacheDir(), safeName);
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write(imageBytes);
                fos.flush();
            }
            return FileProvider.getUriForFile(
                MainActivity.this,
                getPackageName() + ".fileprovider",
                outFile
            );
        }

        @Keep
        @JavascriptInterface
        public void shareImage(final String base64Png, final String fileName, final String title, final String captionText) {
            runOnUiThread(() -> {
                try {
                    Uri contentUri = writeBase64PngToCache(base64Png, fileName);
                    Intent shareIntent = new Intent(Intent.ACTION_SEND);
                    shareIntent.setType("image/png");
                    shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                    if (captionText != null && !captionText.isEmpty()) {
                        shareIntent.putExtra(Intent.EXTRA_TEXT, captionText);
                    }
                    if (title != null && !title.isEmpty()) {
                        shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                    }
                    shareIntent.setClipData(ClipData.newRawUri(title != null ? title : "101010 THE APP", contentUri));
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                    Intent chooser = Intent.createChooser(shareIntent, title != null ? title : "Compartir Diana 101010 THE APP");
                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(chooser);
                } catch (Exception ignored) {}
            });
        }

        @Keep
        @JavascriptInterface
        public void shareWhatsAppImage(final String base64Png, final String fileName, final String captionText) {
            runOnUiThread(() -> {
                try {
                    Uri contentUri = writeBase64PngToCache(base64Png, fileName);
                    Intent waIntent = new Intent(Intent.ACTION_SEND);
                    waIntent.setType("image/png");
                    waIntent.setPackage("com.whatsapp");
                    waIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                    if (captionText != null && !captionText.isEmpty()) {
                        waIntent.putExtra(Intent.EXTRA_TEXT, captionText);
                    }
                    waIntent.setClipData(ClipData.newRawUri("101010 THE APP", contentUri));
                    waIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                    try {
                        startActivity(waIntent);
                    } catch (Exception notInstalled) {
                        // Fallback to WhatsApp Business or general Android chooser
                        Intent chooser = Intent.createChooser(waIntent.setPackage(null), "Compartir Planilla por WhatsApp");
                        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(chooser);
                    }
                } catch (Exception ignored) {}
            });
        }

        @Keep
        @JavascriptInterface
        public void shareWhatsAppText(final String text) {
            runOnUiThread(() -> {
                try {
                    Intent waIntent = new Intent(Intent.ACTION_SEND);
                    waIntent.setType("text/plain");
                    waIntent.setPackage("com.whatsapp");
                    waIntent.putExtra(Intent.EXTRA_TEXT, text);
                    try {
                        startActivity(waIntent);
                    } catch (Exception notInstalled) {
                        Intent chooser = Intent.createChooser(waIntent.setPackage(null), "Compartir Planilla por WhatsApp");
                        startActivity(chooser);
                    }
                } catch (Exception ignored) {}
            });
        }

        @Keep
        @JavascriptInterface
        public void saveOrShareFile(final String base64Data, final String fileName, final String mimeType, final String title) {
            runOnUiThread(() -> {
                try {
                    if (base64Data == null || base64Data.isEmpty()) return;
                    String cleanBase64 = base64Data;
                    int commaIdx = cleanBase64.indexOf(',');
                    if (commaIdx != -1) {
                        cleanBase64 = cleanBase64.substring(commaIdx + 1);
                    }
                    byte[] decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
                    File exportsDir = new File(getCacheDir(), "exports");
                    if (!exportsDir.exists()) {
                        exportsDir.mkdirs();
                    }
                    String rawName = (fileName != null && !fileName.trim().isEmpty())
                        ? fileName.trim()
                        : ("Archery101010-" + System.currentTimeMillis());
                    String safeFileName = rawName.replaceAll("[^a-zA-Z0-9._-]", "_");
                    if (safeFileName.isEmpty() || ".".equals(safeFileName) || "..".equals(safeFileName)) {
                        safeFileName = "Archery101010-" + System.currentTimeMillis();
                    }
                    File outFile = new File(exportsDir, safeFileName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(decodedBytes);
                        fos.flush();
                    }
                    Uri contentUri = FileProvider.getUriForFile(
                        MainActivity.this,
                        getPackageName() + ".fileprovider",
                        outFile
                    );
                    String safeMime = (mimeType != null && !mimeType.trim().isEmpty())
                        ? mimeType.trim()
                        : "application/octet-stream";
                    String safeTitle = (title != null && !title.trim().isEmpty())
                        ? title.trim()
                        : safeFileName;

                    Intent shareIntent = new Intent(Intent.ACTION_SEND);
                    shareIntent.setType(safeMime);
                    shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                    shareIntent.putExtra(Intent.EXTRA_SUBJECT, safeTitle);
                    shareIntent.setClipData(ClipData.newRawUri(safeTitle, contentUri));
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                    Intent chooser = Intent.createChooser(shareIntent, safeTitle);
                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(chooser);
                } catch (Exception ignored) {}
            });
        }

        @Keep
        @JavascriptInterface
        public void takeCameraPhoto() {
            runOnUiThread(() -> {
                try {
                    File photoFile = new File(getCacheDir(), "archery_camera_" + System.currentTimeMillis() + ".jpg");
                    pendingCameraCaptureFile = photoFile;
                    Uri photoUri = FileProvider.getUriForFile(
                        MainActivity.this,
                        getPackageName() + ".fileprovider",
                        photoFile
                    );
                    Intent takePictureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);
                    takePictureIntent.setClipData(ClipData.newRawUri("Foto", photoUri));
                    takePictureIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    cameraCaptureLauncher.launch(takePictureIntent);
                } catch (Exception e) {
                    try {
                        Intent fallbackIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        cameraCaptureLauncher.launch(fallbackIntent);
                    } catch (Exception ignored) {}
                }
            });
        }
    }

    private void processCapturedCameraPhoto(Intent data) {
        try {
            Bitmap bmp = null;
            int rotationDegrees = 0;

            if (pendingCameraCaptureFile != null && pendingCameraCaptureFile.exists() && pendingCameraCaptureFile.length() > 0) {
                try {
                    ExifInterface exif = new ExifInterface(pendingCameraCaptureFile.getAbsolutePath());
                    int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                    if (orientation == ExifInterface.ORIENTATION_ROTATE_90) rotationDegrees = 90;
                    else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) rotationDegrees = 180;
                    else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) rotationDegrees = 270;
                } catch (Exception ignored) {}

                BitmapFactory.Options boundsOpts = new BitmapFactory.Options();
                boundsOpts.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(pendingCameraCaptureFile.getAbsolutePath(), boundsOpts);

                int sampleSize = 1;
                int maxDim = Math.max(boundsOpts.outWidth, boundsOpts.outHeight);
                while (maxDim / sampleSize > 2160) {
                    sampleSize *= 2;
                }

                BitmapFactory.Options decodeOpts = new BitmapFactory.Options();
                decodeOpts.inSampleSize = sampleSize;
                bmp = BitmapFactory.decodeFile(pendingCameraCaptureFile.getAbsolutePath(), decodeOpts);
            } else if (data != null && data.getExtras() != null) {
                Object raw = data.getExtras().get("data");
                if (raw instanceof Bitmap) {
                    bmp = (Bitmap) raw;
                }
            }

            if (bmp == null) return;

            int w = bmp.getWidth();
            int h = bmp.getHeight();
            float maxTargetEdge = 1920f;
            float scale = Math.min(1f, maxTargetEdge / Math.max(w, h));

            if (rotationDegrees != 0 || scale < 1f) {
                Matrix matrix = new Matrix();
                if (scale < 1f) {
                    matrix.postScale(scale, scale);
                }
                if (rotationDegrees != 0) {
                    matrix.postRotate(rotationDegrees);
                }
                Bitmap transformed = Bitmap.createBitmap(bmp, 0, 0, w, h, matrix, true);
                if (transformed != bmp) {
                    bmp.recycle();
                    bmp = transformed;
                }
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 90, baos);
            String base64Jpeg = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            final String dataUrl = "data:image/jpeg;base64," + base64Jpeg;

            try {
                if (pendingCameraCaptureFile != null && pendingCameraCaptureFile.exists()) {
                    pendingCameraCaptureFile.delete();
                }
            } catch (Exception ignored) {}

            runOnUiThread(() -> {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    JSONObject detail = new JSONObject();
                    try {
                        detail.put("dataUrl", dataUrl);
                    } catch (Exception ignored) {}
                    String js = "window.dispatchEvent(new CustomEvent('archery-native-camera-photo', { detail: " + detail.toString() + " }));";
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            });
        } catch (Exception ignored) {}
    }

    @Keep
    public class ArcheryWatchNativeBridge {
        @Keep
        @JavascriptInterface
        public void onSessionTelemetryUpdate(final String snapshotJson) {
            cacheAndSyncWatchState(snapshotJson);
        }

        @Keep
        @JavascriptInterface
        public void syncTelemetryToWatch(final String snapshotJson) {
            cacheAndSyncWatchState(snapshotJson);
        }

        @Keep
        @JavascriptInterface
        public void sendWatchCommand(final String cmdJson) {
            byte[] bytes = cmdJson != null ? cmdJson.getBytes(StandardCharsets.UTF_8) : new byte[0];
            broadcastToWearNodes("/archery101010/command", bytes);
            if (cmdJson != null && cmdJson.contains("\"STATE_UPDATE\"")) {
                cacheAndSyncWatchState(cmdJson);
            }
        }

        @Keep
        @JavascriptInterface
        public String getWatchConnectionStatus() {
            flushPendingWatchCommandsToWebView();
            refreshWatchConnectionStatus();
            return buildWatchConnectionStatusJson();
        }

        @Keep
        @JavascriptInterface
        public void pingWatch() {
            try {
                String pingPayload = "{\"type\":\"PING\",\"_ts\":" + System.currentTimeMillis() + "}";
                broadcastToWearNodes("/archery101010/ping", pingPayload.getBytes(StandardCharsets.UTF_8));
                if (lastWatchSnapshotJson != null && !lastWatchSnapshotJson.isEmpty()) {
                    broadcastToWearNodes("/archery101010/telemetry", lastWatchSnapshotJson.getBytes(StandardCharsets.UTF_8));
                    syncStateDataItemToWear(lastWatchSnapshotJson);
                }
                refreshWatchConnectionStatus();
            } catch (Exception ignored) {}
        }

        @Keep
        @JavascriptInterface
        public void notifyWatchListenerReady() {
            isWebWatchListenerReady = true;
            flushPendingWatchCommandsToWebView();
        }

        @Keep
        @JavascriptInterface
        public void flushPendingWatchCommands() {
            isWebWatchListenerReady = true;
            flushPendingWatchCommandsToWebView();
        }

        /**
         * Opens the Google Play listing of the Wear OS app directly ON the paired watch
         * (for every connected watch that does not have the app yet). Falls back to the
         * phone Play Store listing when no watch is reachable.
         */
        @Keep
        @JavascriptInterface
        public void installAppOnWatch() {
            openWearAppInstallOnWatches();
        }
    }

    @Keep
    public class ArcheryLocationNativeBridge {
        @Keep
        @JavascriptInterface
        public void startSessionTracking(final double initialMeters) {
            runOnUiThread(() -> {
                initialSessionMeters = Math.max(0.0, initialMeters);
                sessionAccumulatedMeters = initialSessionMeters;
                accumulatedGpsDistanceM = initialSessionMeters;
                accumulatedSteps = initialSessionMeters > 0 ? (int) Math.round(initialSessionMeters / 0.76) : 0;
                hasGpsFix = false;
                lastValidGpsLocation = null;
                lastGpsFixTimeMs = 0L;
                lastHighAccuracyGpsTimeMs = 0L;
                isSessionTrackingActive = true;

                // 1. Start immediate step/movement tracking via accelerometer
                try {
                    if (nativeSensorManager == null) {
                        nativeSensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
                    }
                    if (nativeSensorManager != null) {
                        nativeAccelerometer = nativeSensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
                        if (nativeAccelerometer != null) {
                            nativeSensorManager.unregisterListener(nativeStepSensorListener);
                            nativeSensorManager.registerListener(nativeStepSensorListener, nativeAccelerometer, SensorManager.SENSOR_DELAY_GAME);
                        }
                    }
                } catch (Exception ignored) {}

                // 2. Request OS runtime location permission if needed, then bind GPS + Fused providers
                boolean fineGranted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                boolean coarseGranted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                if (fineGranted || coarseGranted) {
                    bindNativeGpsProviders();
                } else if (locationPermissionLauncher != null) {
                    locationPermissionLauncher.launch(new String[]{
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    });
                }
                emitLocationSnapshot();
            });
        }

        @Keep
        @JavascriptInterface
        public void stopSessionTracking() {
            runOnUiThread(() -> {
                isSessionTrackingActive = false;
                hasGpsFix = false;
                lastValidGpsLocation = null;
                try {
                    if (nativeLocationManager != null) {
                        nativeLocationManager.removeUpdates(nativeLocationListener);
                    }
                } catch (Exception ignored) {}
                try {
                    if (nativeSensorManager != null) {
                        nativeSensorManager.unregisterListener(nativeStepSensorListener);
                    }
                } catch (Exception ignored) {}
            });
        }
    }

    private void bindNativeGpsProviders() {
        try {
            if (nativeLocationManager == null) {
                nativeLocationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            }
            if (nativeLocationManager == null) return;
            nativeLocationManager.removeUpdates(nativeLocationListener);

            boolean fineGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            boolean coarseGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            if (!fineGranted && !coarseGranted) return;

            if (nativeLocationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                nativeLocationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0.5f, nativeLocationListener, Looper.getMainLooper());
            }
            if (nativeLocationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                nativeLocationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 1000L, 0.5f, nativeLocationListener, Looper.getMainLooper());
            }
            try {
                if (nativeLocationManager.isProviderEnabled("fused")) {
                    nativeLocationManager.requestLocationUpdates("fused", 1000L, 0.5f, nativeLocationListener, Looper.getMainLooper());
                }
            } catch (Exception ignored) {}
            hasGpsFix = (lastValidGpsLocation != null);
            emitLocationSnapshot();
        } catch (Exception ignored) {}
    }

    private void emitLocationSnapshot() {
        pushMovementToWebView();
    }

    private void pushMovementToWebView() {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = String.format(
                    java.util.Locale.US,
                    "if (window.__onNativeMovementUpdate) { window.__onNativeMovementUpdate(%.2f, %b, %d); } else if (window.__onNativeLocationUpdate) { window.__onNativeLocationUpdate(%.2f, %b, %d); }",
                    sessionAccumulatedMeters,
                    hasGpsFix,
                    accumulatedSteps,
                    sessionAccumulatedMeters,
                    hasGpsFix,
                    accumulatedSteps
                );
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private String enrichSnapshotWithAckSeq(final String rawJson) {
        if (rawJson == null || rawJson.isEmpty()) return rawJson;
        try {
            JSONObject obj = new JSONObject(rawJson);
            obj.put("_ackCmdSeq", lastWatchCmdSeq);
            if (!obj.has("sessionActive")) {
                obj.put("sessionActive", true);
            }
            return obj.toString();
        } catch (Exception e) {
            return rawJson;
        }
    }

    private void cacheAndSyncWatchState(final String snapshotJson) {
        if (snapshotJson == null || snapshotJson.isEmpty()) return;
        String enriched = enrichSnapshotWithAckSeq(snapshotJson);
        lastWatchSnapshotJson = enriched;
        try {
            getSharedPreferences(WATCH_BRIDGE_PREFS, MODE_PRIVATE)
                .edit()
                .putString("lastWatchSnapshotJson", enriched)
                .putLong("lastWatchSnapshotTimeMs", System.currentTimeMillis())
                .apply();
        } catch (Exception ignored) {}
        broadcastToWearNodes("/archery101010/telemetry", enriched.getBytes(StandardCharsets.UTF_8));
        syncStateDataItemToWear(enriched);
    }

    private void syncStateDataItemToWear(final String snapshotJson) {
        if (snapshotJson == null || snapshotJson.isEmpty()) return;
        try {
            PutDataMapRequest putDataMapReq = PutDataMapRequest.create("/archery101010/state");
            putDataMapReq.getDataMap().putString("snapshot_json", snapshotJson);
            putDataMapReq.getDataMap().putLong("updated_at", System.currentTimeMillis());
            PutDataRequest putDataReq = putDataMapReq.asPutDataRequest().setUrgent();
            Wearable.getDataClient(this).putDataItem(putDataReq);
        } catch (Exception ignored) {}
    }

    private int scorePointsFromLabel(final String label) {
        if ("X".equalsIgnoreCase(label) || "10".equals(label)) return 10;
        if ("M".equalsIgnoreCase(label) || label == null || label.isEmpty()) return 0;
        try {
            return Integer.parseInt(label);
        } catch (Exception e) {
            return 0;
        }
    }

    private void applyWatchCommandToCachedState(final String cmdType, final JSONObject cmdObj) {
        if (cmdType == null || cmdType.isEmpty() || "REQUEST_STATE".equals(cmdType)) return;
        try {
            JSONObject state = (lastWatchSnapshotJson != null && !lastWatchSnapshotJson.isEmpty())
                ? new JSONObject(lastWatchSnapshotJson)
                : new JSONObject();
            if (state.has("payload") && state.optJSONObject("payload") != null) {
                state = state.optJSONObject("payload");
            }

            long now = System.currentTimeMillis();
            state.put("_ackCmdSeq", lastWatchCmdSeq);
            state.put("updatedAt", now);

            int arrowsPerEnd = Math.max(1, state.optInt("arrowsPerEnd", 6));
            int endsCount = Math.max(1, state.optInt("endsCount", 12));
            int curEndIdx = Math.max(0, state.optInt("currentEndIndex", 0));
            JSONArray curEndArrows = state.optJSONArray("currentEndArrows");
            if (curEndArrows == null) curEndArrows = new JSONArray();

            if ("FINISH_SESSION_FROM_WATCH".equals(cmdType)) {
                state.put("sessionActive", false);
                state.put("arrowsCount", 0);
                state.put("totalScore", 0);
                state.put("currentEndIndex", 0);
                state.put("currentEndArrows", new JSONArray());
                state.put("completedEnds", 0);
            } else if ("INCREMENT_ARROW".equals(cmdType)) {
                int delta = cmdObj != null ? cmdObj.optInt("delta", 1) : 1;
                int prevArrows = Math.max(0, state.optInt("arrowsCount", 0));
                int nextArrows = Math.max(0, prevArrows + delta);
                state.put("arrowsCount", nextArrows);
                if (state.has("totalArrowsVolume")) {
                    int prevVol = Math.max(0, state.optInt("totalArrowsVolume", prevArrows));
                    state.put("totalArrowsVolume", Math.max(0, prevVol + delta));
                }
                state.put("sessionActive", true);
            } else if ("DECREMENT_ARROW".equals(cmdType) || "UNDO_ARROW".equals(cmdType)) {
                int prevArrows = Math.max(0, state.optInt("arrowsCount", 0));
                state.put("arrowsCount", Math.max(0, prevArrows - 1));
                JSONObject payloadObj = cmdObj != null ? cmdObj.optJSONObject("payload") : null;
                int explicitTotal = -1;
                if (cmdObj != null && cmdObj.has("totalScore")) {
                    explicitTotal = cmdObj.optInt("totalScore", -1);
                } else if (payloadObj != null && payloadObj.has("totalScore")) {
                    explicitTotal = payloadObj.optInt("totalScore", -1);
                }
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
                JSONObject payloadObj = cmdObj != null ? cmdObj.optJSONObject("payload") : null;
                String val = payloadObj != null
                    ? payloadObj.optString("value", "")
                    : (cmdObj != null ? cmdObj.optString("value", "") : "");
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
                    int incomingTotal = payloadObj != null
                        ? payloadObj.optInt("totalScore", -1)
                        : (cmdObj != null ? cmdObj.optInt("totalScore", -1) : -1);
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
                JSONObject payloadObj = cmdObj != null ? cmdObj.optJSONObject("payload") : null;
                int steps = payloadObj != null
                    ? payloadObj.optInt("stepsCount", state.optInt("stepsCount", 0))
                    : (cmdObj != null ? cmdObj.optInt("stepsCount", state.optInt("stepsCount", 0)) : 0);
                int walkedM = payloadObj != null
                    ? payloadObj.optInt("distanceWalkedM", state.optInt("distanceWalkedM", 0))
                    : (cmdObj != null ? cmdObj.optInt("distanceWalkedM", state.optInt("distanceWalkedM", 0)) : 0);
                state.put("stepsCount", Math.max(state.optInt("stepsCount", 0), steps));
                state.put("distanceWalkedM", Math.max(state.optInt("distanceWalkedM", 0), walkedM));
            } else if ("TOGGLE_AUTO_DETECT".equals(cmdType) && cmdObj != null) {
                state.put("autoDetectEnabled", cmdObj.optBoolean("enabled", false));
            }

            String updatedJson = state.toString();
            lastWatchSnapshotJson = updatedJson;
            try {
                getSharedPreferences(WATCH_BRIDGE_PREFS, MODE_PRIVATE)
                    .edit()
                    .putString("lastWatchSnapshotJson", updatedJson)
                    .putLong("lastWatchSnapshotTimeMs", now)
                    .apply();
            } catch (Exception ignored) {}
            syncStateDataItemToWear(updatedJson);
        } catch (Exception ignored) {}
    }

    private String buildWatchConnectionStatusJson() {
        try {
            String appVer = "2.75";
            try {
                String vName = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                if (vName != null && !vName.isEmpty()) {
                    appVer = vName;
                }
            } catch (Exception ignored) {}
            JSONObject status = new JSONObject();
            status.put("bridgeReady", true);
            status.put("nativeVersion", appVer);
            status.put("connectedNodesCount", cachedConnectedNodesJson.length());
            status.put("connectedNodes", cachedConnectedNodesJson);
            status.put("watchAppInstalledCount", cachedWatchNodesWithApp.size());
            status.put("watchNodesWithApp", new JSONArray(cachedWatchNodesWithApp));
            status.put("lastMessageAt", lastWatchMessageTimeMs);
            status.put("lastPongAt", lastWatchPongTimeMs);
            status.put("hasCachedState", lastWatchSnapshotJson != null && !lastWatchSnapshotJson.isEmpty());
            return status.toString();
        } catch (Exception e) {
            return "{\"bridgeReady\":true,\"connectedNodesCount\":0}";
        }
    }

    private void emitWatchConnectionStatusToWebView() {
        final String statusJson = buildWatchConnectionStatusJson();
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = "if (window.__onWatchConnectionStatus) { window.__onWatchConnectionStatus(" + statusJson + "); }";
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private void refreshWatchConnectionStatus() {
        try {
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                JSONArray arr = new JSONArray();
                if (nodes != null) {
                    for (Node node : nodes) {
                        try {
                            JSONObject nObj = new JSONObject();
                            nObj.put("id", node.getId());
                            nObj.put("displayName", node.getDisplayName());
                            nObj.put("isNearby", node.isNearby());
                            arr.put(nObj);
                        } catch (Exception ignored) {}
                    }
                }
                cachedConnectedNodesJson = arr;
                emitWatchConnectionStatusToWebView();
            }).addOnFailureListener(err -> {
                emitWatchConnectionStatusToWebView();
            });
        } catch (Exception ignored) {}
        refreshWatchAppCapability();
    }

    /** Detects which paired watches already have the ARCHERY 101010 Wear OS app installed. */
    private void refreshWatchAppCapability() {
        try {
            Wearable.getCapabilityClient(this)
                .getCapability(WEAR_APP_CAPABILITY, CapabilityClient.FILTER_ALL)
                .addOnSuccessListener(info -> {
                    Set<String> ids = new LinkedHashSet<>();
                    if (info != null && info.getNodes() != null) {
                        for (Node n : info.getNodes()) ids.add(n.getId());
                    }
                    cachedWatchNodesWithApp = ids;
                    emitWatchConnectionStatusToWebView();
                });
        } catch (Exception ignored) {}
    }

    /** Launches the Play Store page of the Wear OS app on every connected watch missing it. */
    private void openWearAppInstallOnWatches() {
        final String pkg = getPackageName();
        try {
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                Wearable.getCapabilityClient(this)
                    .getCapability(WEAR_APP_CAPABILITY, CapabilityClient.FILTER_ALL)
                    .addOnCompleteListener(capTask -> {
                        Set<String> withApp = new LinkedHashSet<>();
                        try {
                            CapabilityInfo info = capTask.isSuccessful() ? capTask.getResult() : null;
                            if (info != null) for (Node n : info.getNodes()) withApp.add(n.getId());
                        } catch (Exception ignored) {}
                        cachedWatchNodesWithApp = withApp;

                        int launched = 0;
                        if (nodes != null) {
                            RemoteActivityHelper helper = new RemoteActivityHelper(this, Executors.newSingleThreadExecutor());
                            Intent playIntent = new Intent(Intent.ACTION_VIEW)
                                .addCategory(Intent.CATEGORY_BROWSABLE)
                                .setData(Uri.parse("market://details?id=" + pkg));
                            for (Node node : nodes) {
                                if (withApp.contains(node.getId())) continue;
                                try {
                                    helper.startRemoteActivity(playIntent, node.getId());
                                    launched++;
                                } catch (Exception ignored) {}
                            }
                        }
                        final int launchedFinal = launched;
                        final boolean anyNode = nodes != null && !nodes.isEmpty();
                        runOnUiThread(() -> {
                            if (launchedFinal > 0) {
                                android.widget.Toast.makeText(this, "Revisa tu reloj: se abrió Google Play para instalar ARCHERY 101010", android.widget.Toast.LENGTH_LONG).show();
                            } else if (anyNode) {
                                android.widget.Toast.makeText(this, "La app ya está instalada en tu reloj", android.widget.Toast.LENGTH_LONG).show();
                            } else {
                                openPhonePlayStoreListing(pkg);
                            }
                        });
                        emitWatchConnectionStatusToWebView();
                    });
            }).addOnFailureListener(err -> runOnUiThread(() -> openPhonePlayStoreListing(pkg)));
        } catch (Exception e) {
            runOnUiThread(() -> openPhonePlayStoreListing(pkg));
        }
    }

    private void openPhonePlayStoreListing(String pkg) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {}
        }
    }

    private void broadcastToWearNodes(final String path, final byte[] data) {
        try {
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                JSONArray arr = new JSONArray();
                if (nodes != null) {
                    for (Node node : nodes) {
                        Wearable.getMessageClient(this).sendMessage(node.getId(), path, data);
                        try {
                            JSONObject nObj = new JSONObject();
                            nObj.put("id", node.getId());
                            nObj.put("displayName", node.getDisplayName());
                            nObj.put("isNearby", node.isNearby());
                            arr.put(nObj);
                        } catch (Exception ignored) {}
                    }
                }
                cachedConnectedNodesJson = arr;
            });
        } catch (Exception ignored) {}
    }

    private void handleIncomingWatchPayload(final String path, final String payload, final String sourceNodeId) {
        if (payload == null) return;
        long now = System.currentTimeMillis();
        lastWatchMessageTimeMs = now;

        if ("/archery101010/ping".equals(path)) {
            lastWatchPongTimeMs = now;
            byte[] pongBytes = ("{\"type\":\"PONG\",\"_ts\":" + now + "}").getBytes(StandardCharsets.UTF_8);
            if (sourceNodeId != null && !sourceNodeId.isEmpty()) {
                Wearable.getMessageClient(this).sendMessage(sourceNodeId, "/archery101010/pong", pongBytes);
            } else {
                broadcastToWearNodes("/archery101010/pong", pongBytes);
            }
            if (lastWatchSnapshotJson != null && !lastWatchSnapshotJson.isEmpty()) {
                String enriched = enrichSnapshotWithAckSeq(lastWatchSnapshotJson);
                broadcastToWearNodes("/archery101010/telemetry", enriched.getBytes(StandardCharsets.UTF_8));
            }
            refreshWatchConnectionStatus();
            return;
        }

        if ("/archery101010/pong".equals(path)) {
            lastWatchPongTimeMs = now;
            refreshWatchConnectionStatus();
            return;
        }

        // Live pulse streamed by the ARCHERY 101010 watch app (watches without standard BLE pulse broadcast)
        if ("/archery101010/hr".equals(path)) {
            lastWatchPongTimeMs = now;
            emitWearHeartRateToWebView(payload, sourceNodeId);
            return;
        }

        String cmdType = "";
        String cmdId = "";
        long cmdSeq = 0L;
        JSONObject parsedCmdObj = null;
        try {
            parsedCmdObj = new JSONObject(payload);
            cmdType = parsedCmdObj.optString("type", "");
            cmdId = parsedCmdObj.optString("_cmdId", "");
            cmdSeq = parsedCmdObj.optLong("_cmdSeq", 0L);
        } catch (Exception ignored) {}

        // Deduplicate commands delivered simultaneously over MessageClient and DataClient
        if (!cmdId.isEmpty()) {
            synchronized (processedWatchCmdIds) {
                if (processedWatchCmdIds.contains(cmdId)) {
                    return;
                }
                processedWatchCmdIds.add(cmdId);
                if (processedWatchCmdIds.size() > 120) {
                    Iterator<String> it = processedWatchCmdIds.iterator();
                    if (it.hasNext()) {
                        it.next();
                        it.remove();
                    }
                }
            }
        }

        if (cmdSeq > lastWatchCmdSeq) {
            lastWatchCmdSeq = cmdSeq;
        }

        // Update native cached snapshot immediately so screen-off REQUEST_STATE replies never serve stale pre-pocket data
        if (!"REQUEST_STATE".equals(cmdType)) {
            applyWatchCommandToCachedState(cmdType, parsedCmdObj);
        }

        // Native immediate reply when watch requests state (works even when phone screen is off/locked in pocket!)
        if ("REQUEST_STATE".equals(cmdType)) {
            if (lastWatchSnapshotJson != null && !lastWatchSnapshotJson.isEmpty()) {
                String enriched = enrichSnapshotWithAckSeq(lastWatchSnapshotJson);
                byte[] stateBytes = enriched.getBytes(StandardCharsets.UTF_8);
                if (sourceNodeId != null && !sourceNodeId.isEmpty()) {
                    Wearable.getMessageClient(this).sendMessage(sourceNodeId, "/archery101010/telemetry", stateBytes);
                } else {
                    broadcastToWearNodes("/archery101010/telemetry", stateBytes);
                }
            }
        }

        final String finalCmdType = cmdType;
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String safePayload = JSONObject.quote(payload);
                String js =
                    "(function() { if (window.__archeryWatchListenerReady === true && typeof window.__onNativeWatchMessage === 'function') { window.__onNativeWatchMessage(" +
                    safePayload +
                    "); return 'DELIVERED'; } return 'PENDING'; })()";
                getBridge().getWebView().evaluateJavascript(js, result -> {
                    if (result == null || !result.contains("DELIVERED")) {
                        if (!"REQUEST_STATE".equals(finalCmdType)) {
                            synchronized (pendingWatchCommands) {
                                if (pendingWatchCommands.size() < 100 && !pendingWatchCommands.contains(payload)) {
                                    pendingWatchCommands.add(payload);
                                }
                            }
                        }
                    }
                });
            } else if (!"REQUEST_STATE".equals(finalCmdType)) {
                synchronized (pendingWatchCommands) {
                    if (pendingWatchCommands.size() < 100 && !pendingWatchCommands.contains(payload)) {
                        pendingWatchCommands.add(payload);
                    }
                }
            }
        });
    }

    private void flushPendingWatchCommandsToWebView() {
        try {
            String persistedQueue = getSharedPreferences(WATCH_BRIDGE_PREFS, MODE_PRIVATE)
                .getString("pendingWatchCommandsJson", "[]");
            if (persistedQueue != null && !persistedQueue.isEmpty() && !"[]".equals(persistedQueue)) {
                getSharedPreferences(WATCH_BRIDGE_PREFS, MODE_PRIVATE)
                    .edit()
                    .putString("pendingWatchCommandsJson", "[]")
                    .apply();
                JSONArray arr = new JSONArray(persistedQueue);
                synchronized (pendingWatchCommands) {
                    for (int i = 0; i < arr.length(); i++) {
                        String cmd = arr.optString(i, "");
                        if (cmd != null && !cmd.isEmpty() && pendingWatchCommands.size() < 100 && !pendingWatchCommands.contains(cmd)) {
                            pendingWatchCommands.add(cmd);
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        if (!isWebWatchListenerReady) {
            return;
        }

        final List<String> toFlush;
        synchronized (pendingWatchCommands) {
            if (pendingWatchCommands.isEmpty()) return;
            toFlush = new ArrayList<>(pendingWatchCommands);
            pendingWatchCommands.clear();
        }
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                for (final String cmdPayload : toFlush) {
                    String safePayload = JSONObject.quote(cmdPayload);
                    String js =
                        "(function() { if (window.__archeryWatchListenerReady === true && typeof window.__onNativeWatchMessage === 'function') { window.__onNativeWatchMessage(" +
                        safePayload +
                        "); return 'DELIVERED'; } return 'PENDING'; })()";
                    getBridge().getWebView().evaluateJavascript(js, result -> {
                        if (result == null || !result.contains("DELIVERED")) {
                            synchronized (pendingWatchCommands) {
                                if (pendingWatchCommands.size() < 100 && !pendingWatchCommands.contains(cmdPayload)) {
                                    pendingWatchCommands.add(cmdPayload);
                                }
                            }
                        }
                    });
                }
            } else {
                synchronized (pendingWatchCommands) {
                    for (String cmdPayload : toFlush) {
                        if (pendingWatchCommands.size() < 100 && !pendingWatchCommands.contains(cmdPayload)) {
                            pendingWatchCommands.add(cmdPayload);
                        }
                    }
                }
            }
        });
    }

    private void initWearableListener() {
        try {
            String savedSnapshot = getSharedPreferences(WATCH_BRIDGE_PREFS, MODE_PRIVATE)
                .getString("lastWatchSnapshotJson", "");
            if (savedSnapshot != null && !savedSnapshot.isEmpty() && lastWatchSnapshotJson.isEmpty()) {
                lastWatchSnapshotJson = savedSnapshot;
            }
        } catch (Exception ignored) {}

        try {
            if (wearMessageListener != null) {
                Wearable.getMessageClient(this).removeListener(wearMessageListener);
            }
            wearMessageListener = (MessageEvent event) -> {
                if (event == null || event.getPath() == null) return;
                String path = event.getPath();
                if (path.startsWith("/archery101010/")) {
                    String payload = event.getData() != null
                        ? new String(event.getData(), StandardCharsets.UTF_8)
                        : "";
                    handleIncomingWatchPayload(path, payload, event.getSourceNodeId());
                }
            };
            Wearable.getMessageClient(this).addListener(wearMessageListener);
        } catch (Exception ignored) {}

        try {
            if (wearDataListener != null) {
                Wearable.getDataClient(this).removeListener(wearDataListener);
            }
            wearDataListener = (DataEventBuffer dataEvents) -> {
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
                                    handleIncomingWatchPayload("/archery101010/command", cmdJson, "");
                                }
                            }
                        }
                    }
                }
            };
            Wearable.getDataClient(this).addListener(wearDataListener);
        } catch (Exception ignored) {}

        refreshWatchConnectionStatus();
    }

    @Keep
    public class ArcherySpotifyBridge {
        /** Connects the official Spotify App Remote player (no embedded WebView login or cookie scraping). */
        @Keep
        @JavascriptInterface
        public void openSpotifyLogin() {
            runOnUiThread(() -> connectSpotifyRemote(null));
        }

        @Keep
        @JavascriptInterface
        public boolean isSpotifyAppInstalled() {
            return isSpotifyAppInstalledInternal();
        }

        /**
         * Opens a playlist / album / track directly in the official Spotify app (full songs, background
         * playback, works for every user). Falls back to the web player or the Play Store listing.
         */
        @Keep
        @JavascriptInterface
        public void openInSpotifyApp(final String spotifyUri, final String webUrl) {
            runOnUiThread(() -> {
                if (isSpotifyAppInstalledInternal()) {
                    boolean wantsDirectHome = spotifyUri == null
                            || spotifyUri.isEmpty()
                            || "spotify:".equalsIgnoreCase(spotifyUri)
                            || "spotify://open".equalsIgnoreCase(spotifyUri)
                            || "spotify:app".equalsIgnoreCase(spotifyUri);
                    if (!wantsDirectHome) {
                        try {
                            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(spotifyUri));
                            i.setPackage("com.spotify.music");
                            i.putExtra(Intent.EXTRA_REFERRER, Uri.parse("android-app://" + getPackageName()));
                            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(i);
                            return;
                        } catch (Exception ignored) {}
                    }
                    try {
                        Intent launchIntent = getPackageManager().getLaunchIntentForPackage("com.spotify.music");
                        if (launchIntent != null) {
                            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(launchIntent);
                            return;
                        }
                    } catch (Exception ignored) {}
                }
                try {
                    if (webUrl != null && !webUrl.isEmpty()) {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(webUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        return;
                    }
                } catch (Exception ignored) {}
                openPhonePlayStoreListing("com.spotify.music");
            });
        }

        @Keep
        @JavascriptInterface
        public boolean isSpotifyPlayerConnected() {
            return spotifyRemote != null && spotifyRemote.isConnected();
        }

        @Keep
        @JavascriptInterface
        public boolean hasSpotifyClientId() {
            return !resolveSpotifyClientId(null).isEmpty();
        }

        @Keep
        @JavascriptInterface
        public void connectSpotifyPlayer(final String clientId) {
            runOnUiThread(() -> connectSpotifyRemote(clientId));
        }

        @Keep
        @JavascriptInterface
        public void spotifyPlay(final String spotifyUri) {
            runOnUiThread(() -> {
                if (spotifyRemote != null && spotifyRemote.isConnected()) {
                    spotifyRemote.getPlayerApi().play(spotifyUri);
                } else {
                    pendingSpotifyUri = spotifyUri;
                    connectSpotifyRemote(null);
                }
            });
        }

        @Keep
        @JavascriptInterface
        public void spotifyTogglePlay() {
            runOnUiThread(() -> {
                if (spotifyRemote == null || !spotifyRemote.isConnected()) return;
                if (lastSpotifyPaused) spotifyRemote.getPlayerApi().resume();
                else spotifyRemote.getPlayerApi().pause();
            });
        }

        @Keep
        @JavascriptInterface
        public void spotifyPause() {
            runOnUiThread(() -> { if (spotifyRemote != null && spotifyRemote.isConnected()) spotifyRemote.getPlayerApi().pause(); });
        }

        @Keep
        @JavascriptInterface
        public void spotifyNext() {
            runOnUiThread(() -> { if (spotifyRemote != null && spotifyRemote.isConnected()) spotifyRemote.getPlayerApi().skipNext(); });
        }

        @Keep
        @JavascriptInterface
        public void spotifyPrevious() {
            runOnUiThread(() -> { if (spotifyRemote != null && spotifyRemote.isConnected()) spotifyRemote.getPlayerApi().skipPrevious(); });
        }

        @Keep
        @JavascriptInterface
        public boolean hasActiveSpotifySession() {
            return spotifyRemote != null && spotifyRemote.isConnected();
        }

        @Keep
        @JavascriptInterface
        public void clearSpotifySession() {
            runOnUiThread(() -> {
                try {
                    if (spotifyRemote != null) {
                        SpotifyAppRemote.disconnect(spotifyRemote);
                        spotifyRemote = null;
                    }
                    getSharedPreferences(SPOTIFY_PREFS, MODE_PRIVATE).edit().clear().apply();
                } catch (Exception ignored) {}
            });
        }
    }

    // ───────────── Official Spotify App Remote (playback controlled from ARCHERY 101010) ─────────────
    private static final String SPOTIFY_REDIRECT_URI = "archery101010://spotify-callback";
    private SpotifyAppRemote spotifyRemote = null;
    private volatile String pendingSpotifyUri = null;
    private volatile boolean lastSpotifyPaused = true;
    private boolean spotifyConnecting = false;

    private boolean isSpotifyAppInstalledInternal() {
        try {
            getPackageManager().getPackageInfo("com.spotify.music", 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String resolveSpotifyClientId(String fromJs) {
        if (fromJs != null && !fromJs.trim().isEmpty()) {
            getSharedPreferences(SPOTIFY_PREFS, MODE_PRIVATE).edit().putString("client_id", fromJs.trim()).apply();
            return fromJs.trim();
        }
        String saved = getSharedPreferences(SPOTIFY_PREFS, MODE_PRIVATE).getString("client_id", "");
        if (saved != null && !saved.trim().isEmpty()) return saved.trim();
        try {
            return getString(R.string.spotify_client_id).trim();
        } catch (Exception e) {
            return "";
        }
    }

    private void emitSpotifyRemoteState(boolean connected, String error, PlayerState ps) {
        try {
            JSONObject o = new JSONObject();
            o.put("connected", connected);
            o.put("appInstalled", isSpotifyAppInstalledInternal());
            if (error != null) o.put("error", error);
            if (ps != null) {
                lastSpotifyPaused = ps.isPaused;
                o.put("isPaused", ps.isPaused);
                if (ps.track != null) {
                    o.put("track", ps.track.name);
                    o.put("artist", ps.track.artist != null ? ps.track.artist.name : "");
                    o.put("uri", ps.track.uri);
                    o.put("durationMs", ps.track.duration);
                }
                o.put("positionMs", ps.playbackPosition);
            }
            final String js = "if (window.__onSpotifyRemoteState) { window.__onSpotifyRemoteState(" + o + "); }";
            runOnUiThread(() -> {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            });
        } catch (Exception ignored) {}
    }

    private void connectSpotifyRemote(String clientIdFromJs) {
        if (!isSpotifyAppInstalledInternal()) {
            emitSpotifyRemoteState(false, "SPOTIFY_NOT_INSTALLED", null);
            openPhonePlayStoreListing("com.spotify.music");
            return;
        }
        final String clientId = resolveSpotifyClientId(clientIdFromJs);
        if (clientId.isEmpty()) {
            emitSpotifyRemoteState(false, "MISSING_CLIENT_ID", null);
            return;
        }
        if (spotifyRemote != null && spotifyRemote.isConnected()) {
            onSpotifyRemoteReady();
            return;
        }
        if (spotifyConnecting) return;
        spotifyConnecting = true;
        ConnectionParams params = new ConnectionParams.Builder(clientId)
            .setRedirectUri(SPOTIFY_REDIRECT_URI)
            .showAuthView(true) // authorization happens inside the official Spotify app
            .build();
        SpotifyAppRemote.connect(this, params, new Connector.ConnectionListener() {
            @Override
            public void onConnected(SpotifyAppRemote remote) {
                spotifyConnecting = false;
                spotifyRemote = remote;
                onSpotifyRemoteReady();
            }

            @Override
            public void onFailure(Throwable error) {
                spotifyConnecting = false;
                String code = error != null ? error.getClass().getSimpleName() : "UNKNOWN";
                emitSpotifyRemoteState(false, code, null);
            }
        });
    }

    private void onSpotifyRemoteReady() {
        if (spotifyRemote == null) return;
        spotifyRemote.getPlayerApi().subscribeToPlayerState().setEventCallback(ps -> emitSpotifyRemoteState(true, null, ps));
        emitSpotifyRemoteState(true, null, null);
        if (pendingSpotifyUri != null) {
            spotifyRemote.getPlayerApi().play(pendingSpotifyUri);
            pendingSpotifyUri = null;
        }
    }

    // ───────────── Standard Bluetooth Low Energy (BLE) Heart Rate Sensor Bridge (0x180D / 0x2A37) ─────────────
    private static final UUID BLE_HR_SERVICE_UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
    private static final UUID BLE_HR_MEASUREMENT_UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
    private static final UUID BLE_CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final UUID BLE_BATTERY_SERVICE_UUID = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb");
    private static final UUID BLE_BATTERY_LEVEL_UUID = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb");

    private final Handler bleMainHandler = new Handler(Looper.getMainLooper());
    private volatile BluetoothGatt activeBleGatt = null;
    private volatile boolean isBleScanning = false;
    private volatile boolean isBleGattConnected = false;
    private volatile boolean bleUserRequestedDisconnect = false;
    private volatile boolean bleConnectedOnce = false;
    private volatile int pendingBleActionAfterPermission = 0; // 1 = scan, 2 = connect
    private volatile String pendingBleConnectAddress = null;
    private volatile String pendingBleConnectName = null;
    private volatile String bleHrState = "disconnected";
    private volatile String bleHrDeviceId = "";
    private volatile String bleHrDeviceName = "";
    private volatile String bleHrErrorCode = "";
    private volatile Integer bleBatteryPct = null;
    private volatile int bleConnectRetryCount = 0;
    private volatile int bleAutoReconnectAttempts = 0;
    private volatile long lastBleScanDevicesEmitMs = 0L;
    private static final long[] BLE_RECONNECT_BACKOFF_MS = new long[]{
        2500L, 5000L, 10000L, 15000L, 20000L, 30000L
    };

    private final Runnable bleScanDevicesFlushRunnable = () -> {
        lastBleScanDevicesEmitMs = System.currentTimeMillis();
        emitBleHrDevicesToWebView();
    };

    private final Runnable bleCccdConfirmFallbackRunnable = () -> {
        if (activeBleGatt != null && isBleGattConnected && !"connected".equals(bleHrState)) {
            bleHrState = "connected";
            bleHrErrorCode = "";
            emitBleHrStatusToWebView(null);
        }
    };

    private final Runnable bleReconnectRunnable = () -> {
        if (!bleUserRequestedDisconnect && activeBleGatt == null && bleHrDeviceId != null && !bleHrDeviceId.isEmpty()) {
            connectBleHrDeviceInternal(bleHrDeviceId, bleHrDeviceName, true);
        }
    };

    private final Runnable bleConnectTimeoutRunnable = () -> {
        if ("connecting".equals(bleHrState) && !bleConnectedOnce) {
            if (activeBleGatt != null) {
                try {
                    activeBleGatt.disconnect();
                    activeBleGatt.close();
                } catch (Exception ignored) {}
                activeBleGatt = null;
            }
            bleHrState = "error";
            bleHrErrorCode = "CONNECT_FAILED";
            emitBleHrStatusToWebView(null);
        }
    };

    private static class BleDiscoveredEntry {
        String id;
        String name;
        int rssi;
        boolean hasHrService;
        boolean isBondedOrConnected;
    }

    private final Map<String, BleDiscoveredEntry> discoveredBleDevices =
        Collections.synchronizedMap(new LinkedHashMap<>());
    private final Map<String, BluetoothDevice> cachedBleDevicesByAddr =
        Collections.synchronizedMap(new LinkedHashMap<>());
    private volatile Runnable pendingConnectAfterStopScanRunnable = null;
    private volatile int bleCccdRetryAttempt = 0;

    @SuppressLint("MissingPermission")
    private boolean deviceCachesHrServiceUuid(BluetoothDevice dev) {
        if (dev == null) return false;
        try {
            ParcelUuid[] uuids = dev.getUuids();
            if (uuids != null) {
                for (ParcelUuid pu : uuids) {
                    if (pu != null && BLE_HR_SERVICE_UUID.equals(pu.getUuid())) {
                        return true;
                    }
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    @SuppressLint("MissingPermission")
    private boolean isObviouslyNonHrAccessory(BluetoothDevice dev, String cleanName, boolean advertisesHr) {
        if (advertisesHr) return false;
        if (dev != null) {
            try {
                BluetoothClass btClass = dev.getBluetoothClass();
                if (btClass != null) {
                    int major = btClass.getMajorDeviceClass();
                    if (major == BluetoothClass.Device.Major.AUDIO_VIDEO ||
                        major == BluetoothClass.Device.Major.COMPUTER ||
                        major == BluetoothClass.Device.Major.PHONE ||
                        major == BluetoothClass.Device.Major.IMAGING ||
                        major == BluetoothClass.Device.Major.PERIPHERAL ||
                        major == BluetoothClass.Device.Major.NETWORKING) {
                        return true;
                    }
                }
            } catch (Exception ignored) {}
        }
        if (cleanName != null && !cleanName.isEmpty()) {
            String lower = cleanName.toLowerCase(java.util.Locale.ROOT);
            if (lower.contains("shutter") ||
                lower.contains("keyboard") ||
                lower.contains("mouse") ||
                lower.contains("gamepad") ||
                lower.contains("controller") ||
                lower.contains("airpods") ||
                lower.contains("earbuds") ||
                lower.contains("buds") ||
                lower.contains("headphone") ||
                lower.contains("speaker") ||
                lower.contains("handsfree") ||
                lower.contains("smarttag")) {
                return true;
            }
        }
        return false;
    }

    private final Runnable stopBleScanTimeoutRunnable = () -> {
        stopBleHrScanInternal();
    };

    private BluetoothManager getBleManagerInternal() {
        try {
            return (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        } catch (Exception e) {
            return null;
        }
    }

    private BluetoothAdapter getBleAdapterInternal() {
        BluetoothManager mgr = getBleManagerInternal();
        return mgr != null ? mgr.getAdapter() : null;
    }

    private boolean hasBlePermissionsInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isLocationEnabledForLegacyBle() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return true;
        try {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return lm.isLocationEnabled();
            }
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return true;
        }
    }

    private void requestBlePermissionsInternal(int nextAction) {
        pendingBleActionAfterPermission = nextAction;
        if (blePermissionLauncher == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            blePermissionLauncher.launch(new String[]{
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
            });
        } else {
            blePermissionLauncher.launch(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            });
        }
    }

    private JSONArray buildBleDevicesJsonArray() {
        List<BleDiscoveredEntry> snapshot;
        synchronized (discoveredBleDevices) {
            snapshot = new ArrayList<>(discoveredBleDevices.values());
        }
        Collections.sort(snapshot, (a, b) -> {
            if (a.hasHrService != b.hasHrService) return a.hasHrService ? -1 : 1;
            if (a.isBondedOrConnected != b.isBondedOrConnected) return a.isBondedOrConnected ? -1 : 1;
            return Integer.compare(b.rssi, a.rssi);
        });
        JSONArray arr = new JSONArray();
        for (BleDiscoveredEntry item : snapshot) {
            try {
                JSONObject o = new JSONObject();
                o.put("id", item.id);
                o.put("name", item.name);
                o.put("rssi", item.rssi);
                o.put("hasHrService", item.hasHrService);
                o.put("isBondedOrConnected", item.isBondedOrConnected);
                arr.put(o);
            } catch (Exception ignored) {}
        }
        return arr;
    }

    private JSONObject buildBleHrStatusJsonObject(byte[] rawHrBytes) {
        JSONObject obj = new JSONObject();
        try {
            obj.put("state", bleHrState);
            obj.put("deviceId", bleHrDeviceId != null ? bleHrDeviceId : "");
            obj.put("deviceName", bleHrDeviceName != null ? bleHrDeviceName : "");
            obj.put("errorCode", bleHrErrorCode != null ? bleHrErrorCode : "");
            if (bleBatteryPct != null) {
                obj.put("batteryPct", bleBatteryPct);
            } else {
                obj.put("batteryPct", JSONObject.NULL);
            }
            if (rawHrBytes == null) {
                obj.put("devices", buildBleDevicesJsonArray());
            }
            if (rawHrBytes != null && rawHrBytes.length >= 2) {
                JSONArray bytesArr = new JSONArray();
                for (byte b : rawHrBytes) {
                    bytesArr.put(b & 0xFF);
                }
                obj.put("rawBytes", bytesArr);
            }
        } catch (Exception ignored) {}
        return obj;
    }

    private void emitBleHrStatusToWebView(final byte[] rawHrBytes) {
        final String quotedJson = JSONObject.quote(buildBleHrStatusJsonObject(rawHrBytes).toString());
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = "if (window.__onNativeBleHrUpdate) { window.__onNativeBleHrUpdate(" + quotedJson + "); }";
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private void emitBleHrDevicesToWebView() {
        final String quotedArr = JSONObject.quote(buildBleDevicesJsonArray().toString());
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = "if (window.__onNativeBleHrDevices) { window.__onNativeBleHrDevices(" + quotedArr + "); }";
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    @SuppressLint("MissingPermission")
    private final ScanCallback bleHrScanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            if (result == null || result.getDevice() == null) return;
            BluetoothDevice dev = result.getDevice();
            String addr = dev.getAddress();
            if (addr == null || addr.isEmpty()) return;

            boolean advertisesHr = deviceCachesHrServiceUuid(dev);
            String scanName = null;
            ScanRecord record = result.getScanRecord();
            if (record != null) {
                scanName = record.getDeviceName();
                List<ParcelUuid> uuids = record.getServiceUuids();
                if (uuids != null) {
                    for (ParcelUuid pu : uuids) {
                        if (pu != null && BLE_HR_SERVICE_UUID.equals(pu.getUuid())) {
                            advertisesHr = true;
                            break;
                        }
                    }
                }
                if (!advertisesHr) {
                    Map<ParcelUuid, byte[]> svcData = record.getServiceData();
                    if (svcData != null) {
                        for (ParcelUuid pu : svcData.keySet()) {
                            if (pu != null && BLE_HR_SERVICE_UUID.equals(pu.getUuid())) {
                                advertisesHr = true;
                                break;
                            }
                        }
                    }
                }
                if (!advertisesHr && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    List<ParcelUuid> solUuids = record.getServiceSolicitationUuids();
                    if (solUuids != null) {
                        for (ParcelUuid pu : solUuids) {
                            if (pu != null && BLE_HR_SERVICE_UUID.equals(pu.getUuid())) {
                                advertisesHr = true;
                                break;
                            }
                        }
                    }
                }
            }
            String devName = null;
            try {
                devName = dev.getName();
            } catch (Exception ignored) {}
            String cleanName = (devName != null && !devName.trim().isEmpty())
                ? devName.trim()
                : (scanName != null && !scanName.trim().isEmpty() ? scanName.trim() : "");

            // Show devices advertising 0x180D (even if unnamed) plus named nearby BLE wearables, excluding non-HR audio/HID gadgets
            if (!advertisesHr && cleanName.isEmpty()) return;
            if (isObviouslyNonHrAccessory(dev, cleanName, advertisesHr)) return;

            cachedBleDevicesByAddr.put(addr, dev);

            synchronized (discoveredBleDevices) {
                BleDiscoveredEntry existing = discoveredBleDevices.get(addr);
                if (existing == null) {
                    existing = new BleDiscoveredEntry();
                    existing.id = addr;
                    existing.name = cleanName.isEmpty() ? "Sensor Bluetooth" : cleanName;
                    existing.rssi = result.getRssi();
                    existing.hasHrService = advertisesHr;
                    existing.isBondedOrConnected = false;
                    discoveredBleDevices.put(addr, existing);
                } else {
                    if (!cleanName.isEmpty()) existing.name = cleanName;
                    existing.rssi = result.getRssi();
                    if (advertisesHr) existing.hasHrService = true;
                }
            }
            long nowMs = System.currentTimeMillis();
            if (nowMs - lastBleScanDevicesEmitMs >= 350L) {
                bleMainHandler.removeCallbacks(bleScanDevicesFlushRunnable);
                lastBleScanDevicesEmitMs = nowMs;
                emitBleHrDevicesToWebView();
            } else {
                bleMainHandler.removeCallbacks(bleScanDevicesFlushRunnable);
                bleMainHandler.postDelayed(bleScanDevicesFlushRunnable, 350L);
            }
        }

        @Override
        public void onScanFailed(int errorCode) {
            isBleScanning = false;
            bleMainHandler.removeCallbacks(stopBleScanTimeoutRunnable);
            bleMainHandler.removeCallbacks(bleScanDevicesFlushRunnable);
            if ("scanning".equals(bleHrState)) {
                bleHrState = isBleGattConnected ? "connected" : "disconnected";
            }
            emitBleHrStatusToWebView(null);
        }
    };

    @SuppressLint("MissingPermission")
    private void populateConnectedAndBondedBleDevices() {
        if (!hasBlePermissionsInternal()) return;
        BluetoothManager mgr = getBleManagerInternal();
        BluetoothAdapter adapter = mgr != null ? mgr.getAdapter() : null;
        if (mgr != null) {
            try {
                List<BluetoothDevice> gattConnected = mgr.getConnectedDevices(BluetoothProfile.GATT);
                if (gattConnected != null) {
                    for (BluetoothDevice dev : gattConnected) {
                        if (dev == null || dev.getAddress() == null) continue;
                        String name = dev.getName();
                        if (name == null || name.trim().isEmpty()) continue;
                        String clean = name.trim();
                        boolean cachedHr = deviceCachesHrServiceUuid(dev);
                        if (isObviouslyNonHrAccessory(dev, clean, cachedHr)) continue;
                        cachedBleDevicesByAddr.put(dev.getAddress(), dev);
                        BleDiscoveredEntry entry = new BleDiscoveredEntry();
                        entry.id = dev.getAddress();
                        entry.name = clean;
                        entry.rssi = -45;
                        entry.hasHrService = cachedHr;
                        entry.isBondedOrConnected = true;
                        discoveredBleDevices.put(entry.id, entry);
                    }
                }
            } catch (Exception ignored) {}
        }
        if (adapter != null) {
            try {
                Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                if (bonded != null) {
                    for (BluetoothDevice dev : bonded) {
                        if (dev == null || dev.getAddress() == null) continue;
                        int type = dev.getType();
                        if (type != BluetoothDevice.DEVICE_TYPE_LE &&
                            type != BluetoothDevice.DEVICE_TYPE_DUAL &&
                            type != BluetoothDevice.DEVICE_TYPE_UNKNOWN) {
                            continue;
                        }
                        String name = dev.getName();
                        if (name == null || name.trim().isEmpty()) continue;
                        String clean = name.trim();
                        boolean cachedHr = deviceCachesHrServiceUuid(dev);
                        if (isObviouslyNonHrAccessory(dev, clean, cachedHr)) continue;
                        cachedBleDevicesByAddr.put(dev.getAddress(), dev);
                        synchronized (discoveredBleDevices) {
                            if (!discoveredBleDevices.containsKey(dev.getAddress())) {
                                BleDiscoveredEntry entry = new BleDiscoveredEntry();
                                entry.id = dev.getAddress();
                                entry.name = clean;
                                entry.rssi = -55;
                                entry.hasHrService = cachedHr;
                                entry.isBondedOrConnected = true;
                                discoveredBleDevices.put(entry.id, entry);
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
    }

    @SuppressLint("MissingPermission")
    private void startBleHrScanInternal() {
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            bleHrState = "unsupported";
            bleHrErrorCode = "BLE_UNSUPPORTED";
            emitBleHrStatusToWebView(null);
            return;
        }
        if (!hasBlePermissionsInternal()) {
            requestBlePermissionsInternal(1);
            return;
        }
        if (!isLocationEnabledForLegacyBle()) {
            bleHrState = "error";
            bleHrErrorCode = "LOCATION_SERVICES_OFF";
            emitBleHrStatusToWebView(null);
            return;
        }
        BluetoothAdapter adapter = getBleAdapterInternal();
        if (adapter == null) {
            bleHrState = "unsupported";
            bleHrErrorCode = "BLE_UNSUPPORTED";
            emitBleHrStatusToWebView(null);
            return;
        }
        if (!adapter.isEnabled()) {
            if (bleEnableLauncher != null) {
                try {
                    bleEnableLauncher.launch(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
                    return;
                } catch (Exception ignored) {}
            }
            bleHrState = "error";
            bleHrErrorCode = "BLUETOOTH_OFF";
            emitBleHrStatusToWebView(null);
            return;
        }

        bleAutoReconnectAttempts = 0;
        bleMainHandler.removeCallbacks(bleReconnectRunnable);
        bleMainHandler.removeCallbacks(bleConnectTimeoutRunnable);
        stopBleHrScanInternal();
        // Close any idle pending autoConnect GATT so it never contends with active BLE scan
        if (activeBleGatt != null && !isBleGattConnected) {
            try {
                activeBleGatt.disconnect();
                activeBleGatt.close();
            } catch (Exception ignored) {}
            activeBleGatt = null;
        }
        discoveredBleDevices.clear();
        populateConnectedAndBondedBleDevices();

        bleHrErrorCode = "";
        try {
            BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
            if (scanner != null) {
                ScanSettings.Builder settingsBuilder = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    settingsBuilder.setLegacy(false);
                }
                ScanSettings settings = settingsBuilder.build();
                isBleScanning = true;
                if (!"connected".equals(bleHrState)) {
                    bleHrState = "scanning";
                }
                emitBleHrStatusToWebView(null);
                scanner.startScan(null, settings, bleHrScanCallback);
                bleMainHandler.removeCallbacks(stopBleScanTimeoutRunnable);
                bleMainHandler.postDelayed(stopBleScanTimeoutRunnable, 12000L);
            } else {
                isBleScanning = false;
                if ("scanning".equals(bleHrState)) bleHrState = "disconnected";
                emitBleHrStatusToWebView(null);
            }
        } catch (Exception e) {
            isBleScanning = false;
            if ("scanning".equals(bleHrState)) bleHrState = "disconnected";
            emitBleHrStatusToWebView(null);
        }
    }

    @SuppressLint("MissingPermission")
    private void stopBleHrScanInternal() {
        bleMainHandler.removeCallbacks(stopBleScanTimeoutRunnable);
        bleMainHandler.removeCallbacks(bleScanDevicesFlushRunnable);
        boolean wasScanning = isBleScanning || "scanning".equals(bleHrState);
        isBleScanning = false;
        if ("scanning".equals(bleHrState)) {
            bleHrState = isBleGattConnected ? "connected" : "disconnected";
        }
        try {
            BluetoothAdapter adapter = getBleAdapterInternal();
            if (adapter != null && adapter.isEnabled() && hasBlePermissionsInternal()) {
                BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
                if (scanner != null) {
                    scanner.stopScan(bleHrScanCallback);
                }
            }
        } catch (Exception ignored) {}
        if (wasScanning) {
            emitBleHrStatusToWebView(null);
        }
    }

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private boolean enableCccdNotifications(BluetoothGatt gatt, BluetoothGattCharacteristic hrChar) {
        gatt.setCharacteristicNotification(hrChar, true);
        BluetoothGattDescriptor cccd = hrChar.getDescriptor(BLE_CCCD_UUID);
        if (cccd == null) return true;
        int props = hrChar.getProperties();
        byte[] enableVal = ((props & BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0 &&
                (props & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0)
                ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            int res = gatt.writeDescriptor(cccd, enableVal);
            return res == 0; // BluetoothStatusCodes.SUCCESS
        } else {
            cccd.setValue(enableVal);
            return gatt.writeDescriptor(cccd);
        }
    }

    @SuppressLint("MissingPermission")
    private void scheduleServiceDiscoveryAttempt(final BluetoothGatt gatt, final int attempt, final int bondWaitCount) {
        bleMainHandler.postDelayed(() -> {
            if (gatt != activeBleGatt || !isBleGattConnected) return;
            try {
                BluetoothDevice dev = gatt.getDevice();
                if (dev != null && dev.getBondState() == BluetoothDevice.BOND_BONDING && bondWaitCount < 8) {
                    scheduleServiceDiscoveryAttempt(gatt, attempt, bondWaitCount + 1);
                    return;
                }
                boolean started = gatt.discoverServices();
                if (!started) {
                    if (attempt < 3) {
                        scheduleServiceDiscoveryAttempt(gatt, attempt + 1, bondWaitCount);
                    } else {
                        isBleGattConnected = false;
                        bleHrState = "error";
                        bleHrErrorCode = "CONNECT_FAILED";
                        try {
                            gatt.disconnect();
                            gatt.close();
                        } catch (Exception ignored) {}
                        activeBleGatt = null;
                        emitBleHrStatusToWebView(null);
                    }
                }
            } catch (Exception e) {
                isBleGattConnected = false;
                bleHrState = "error";
                bleHrErrorCode = "CONNECT_FAILED";
                emitBleHrStatusToWebView(null);
            }
        }, attempt == 0 && bondWaitCount == 0 ? 220L : 420L);
    }

    @SuppressLint("MissingPermission")
    private void scheduleCccdEnableAttempt(final BluetoothGatt gatt, final BluetoothGattCharacteristic hrChar, final int attempt) {
        bleCccdRetryAttempt = attempt;
        bleMainHandler.postDelayed(() -> {
            if (gatt != activeBleGatt || !isBleGattConnected || hrChar == null) return;
            try {
                BluetoothDevice dev = gatt.getDevice();
                if (dev != null && dev.getBondState() == BluetoothDevice.BOND_BONDING && attempt < 6) {
                    scheduleCccdEnableAttempt(gatt, hrChar, attempt + 1);
                    return;
                }
                BluetoothGattDescriptor cccd = hrChar.getDescriptor(BLE_CCCD_UUID);
                if (cccd == null) {
                    gatt.setCharacteristicNotification(hrChar, true);
                    bleHrState = "connected";
                    bleHrErrorCode = "";
                    emitBleHrStatusToWebView(null);
                    return;
                }
                boolean ok = enableCccdNotifications(gatt, hrChar);
                if (ok) {
                    bleMainHandler.removeCallbacks(bleCccdConfirmFallbackRunnable);
                    bleMainHandler.postDelayed(bleCccdConfirmFallbackRunnable, 2200L);
                } else if (attempt < 5) {
                    // Retry when controller returns BUSY (e.g. 201 during Samsung MTU / 0x2A05 exchange)
                    scheduleCccdEnableAttempt(gatt, hrChar, attempt + 1);
                } else {
                    // Final fallback: local notification registration + direct read if supported
                    if ((hrChar.getProperties() & BluetoothGattCharacteristic.PROPERTY_READ) != 0) {
                        try { gatt.readCharacteristic(hrChar); } catch (Exception ignored) {}
                    }
                    bleHrState = "connected";
                    bleHrErrorCode = "";
                    emitBleHrStatusToWebView(null);
                }
            } catch (Exception ignored) {
                if (attempt < 5) {
                    scheduleCccdEnableAttempt(gatt, hrChar, attempt + 1);
                }
            }
        }, attempt == 0 ? 180L : 340L);
    }

    @SuppressLint("MissingPermission")
    private BluetoothDevice resolveBleRemoteDevice(BluetoothAdapter adapter, String cleanAddr, int retryIndex) {
        BluetoothDevice cached = cachedBleDevicesByAddr.get(cleanAddr);
        if (cached != null) return cached;

        BluetoothManager mgr = getBleManagerInternal();
        if (mgr != null) {
            try {
                List<BluetoothDevice> connected = mgr.getConnectedDevices(BluetoothProfile.GATT);
                if (connected != null) {
                    for (BluetoothDevice d : connected) {
                        if (d != null && cleanAddr.equalsIgnoreCase(d.getAddress())) {
                            cachedBleDevicesByAddr.put(cleanAddr, d);
                            return d;
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    if (d != null && cleanAddr.equalsIgnoreCase(d.getAddress())) {
                        cachedBleDevicesByAddr.put(cleanAddr, d);
                        return d;
                    }
                }
            }
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                int savedAddrType = getSharedPreferences(BLE_HR_PREFS, MODE_PRIVATE)
                    .getInt("saved_addr_type", -1);
                int targetType;
                if (savedAddrType == BluetoothDevice.ADDRESS_TYPE_RANDOM || savedAddrType == BluetoothDevice.ADDRESS_TYPE_PUBLIC) {
                    targetType = (retryIndex % 2 == 1)
                        ? (savedAddrType == BluetoothDevice.ADDRESS_TYPE_RANDOM
                            ? BluetoothDevice.ADDRESS_TYPE_PUBLIC
                            : BluetoothDevice.ADDRESS_TYPE_RANDOM)
                        : savedAddrType;
                } else {
                    // Modern BLE heart-rate broadcasts predominantly use Random Static/RPA addresses; try RANDOM first, then PUBLIC
                    targetType = (retryIndex % 2 == 0)
                        ? BluetoothDevice.ADDRESS_TYPE_RANDOM
                        : BluetoothDevice.ADDRESS_TYPE_PUBLIC;
                }
                return adapter.getRemoteLeDevice(cleanAddr, targetType);
            } catch (Exception ignored) {}
        }
        return adapter.getRemoteDevice(cleanAddr);
    }

    @SuppressLint("MissingPermission")
    private final BluetoothGattCallback bleHrGattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (gatt != activeBleGatt) {
                if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    try { gatt.close(); } catch (Exception ignored) {}
                }
                return;
            }
            bleMainHandler.removeCallbacks(bleConnectTimeoutRunnable);
            bleMainHandler.removeCallbacks(bleCccdConfirmFallbackRunnable);
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                isBleGattConnected = true;
                bleHrErrorCode = "";
                // Keep a longer watchdog until service discovery + CCCD finish
                bleMainHandler.postDelayed(bleConnectTimeoutRunnable, 12000L);
                scheduleServiceDiscoveryAttempt(gatt, 0, 0);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                isBleGattConnected = false;
                try {
                    gatt.close();
                } catch (Exception ignored) {}
                activeBleGatt = null;
                bleBatteryPct = null;
                if (!bleUserRequestedDisconnect && bleConnectedOnce && bleHrDeviceId != null && !bleHrDeviceId.isEmpty() && bleAutoReconnectAttempts < BLE_RECONNECT_BACKOFF_MS.length) {
                    long delayMs = BLE_RECONNECT_BACKOFF_MS[bleAutoReconnectAttempts++];
                    bleHrState = "reconnecting";
                    emitBleHrStatusToWebView(null);
                    bleMainHandler.removeCallbacks(bleReconnectRunnable);
                    bleMainHandler.postDelayed(bleReconnectRunnable, delayMs);
                } else if (!bleUserRequestedDisconnect && !bleConnectedOnce && status != BluetoothGatt.GATT_SUCCESS && bleConnectRetryCount < 2 && bleHrDeviceId != null && !bleHrDeviceId.isEmpty()) {
                    // Android GATT 133 / random-vs-public address transient error -> clean retry up to 2x
                    bleConnectRetryCount++;
                    final String retryAddr = bleHrDeviceId;
                    final String retryName = bleHrDeviceName;
                    bleMainHandler.postDelayed(() -> {
                        if (!bleUserRequestedDisconnect && activeBleGatt == null) {
                            connectBleHrDeviceInternal(retryAddr, retryName, false);
                        }
                    }, 650L);
                } else {
                    if (!bleUserRequestedDisconnect && !bleConnectedOnce && status != BluetoothGatt.GATT_SUCCESS) {
                        bleHrState = "error";
                        bleHrErrorCode = "CONNECT_FAILED";
                    } else if (!"error".equals(bleHrState)) {
                        bleHrState = "disconnected";
                    }
                    emitBleHrStatusToWebView(null);
                }
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (gatt != activeBleGatt) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                isBleGattConnected = false;
                bleHrState = "error";
                bleHrErrorCode = "CONNECT_FAILED";
                try {
                    gatt.disconnect();
                    gatt.close();
                } catch (Exception ignored) {}
                activeBleGatt = null;
                emitBleHrStatusToWebView(null);
                return;
            }

            BluetoothGattService hrService = gatt.getService(BLE_HR_SERVICE_UUID);
            BluetoothGattCharacteristic hrChar = hrService != null
                ? hrService.getCharacteristic(BLE_HR_MEASUREMENT_UUID)
                : null;

            if (hrService == null || hrChar == null) {
                // Android may serve a stale cached service table (e.g. pulse broadcast was just enabled
                // on the wearable). Refresh the GATT cache and rediscover once before giving up.
                if (!bleGattCacheRefreshTried) {
                    bleGattCacheRefreshTried = true;
                    if (refreshBleGattCacheInternal(gatt)) {
                        final BluetoothGatt refreshedGatt = gatt;
                        bleMainHandler.postDelayed(() -> {
                            if (refreshedGatt == activeBleGatt && isBleGattConnected) {
                                try {
                                    refreshedGatt.discoverServices();
                                    return;
                                } catch (Exception ignored) {}
                            }
                        }, 700L);
                        return;
                    }
                }
                bleGattCacheRefreshTried = false;
                bleUserRequestedDisconnect = true;
                bleConnectedOnce = false;
                isBleGattConnected = false;
                bleHrState = "error";
                bleHrErrorCode = "HR_BROADCAST_NOT_ENABLED";
                try {
                    gatt.disconnect();
                    gatt.close();
                } catch (Exception ignored) {}
                activeBleGatt = null;
                emitBleHrStatusToWebView(null);
                return;
            }

            bleGattCacheRefreshTried = false;
            bleConnectRetryCount = 0;
            bleAutoReconnectAttempts = 0;
            bleConnectedOnce = true;
            bleHrErrorCode = "";
            bleMainHandler.removeCallbacks(bleConnectTimeoutRunnable);
            try {
                BluetoothDevice liveDev = gatt.getDevice();
                if (liveDev != null && liveDev.getAddress() != null) {
                    cachedBleDevicesByAddr.put(liveDev.getAddress(), liveDev);
                }
                String liveName = liveDev != null ? liveDev.getName() : null;
                if (liveName != null && !liveName.trim().isEmpty()) {
                    bleHrDeviceName = liveName.trim();
                }
                android.content.SharedPreferences.Editor ed = getSharedPreferences(BLE_HR_PREFS, MODE_PRIVATE)
                    .edit()
                    .putString("saved_address", bleHrDeviceId)
                    .putString("saved_name", bleHrDeviceName);
                if (liveDev != null && Build.VERSION.SDK_INT >= 35) {
                    try {
                        ed.putInt("saved_addr_type", liveDev.getAddressType());
                    } catch (Exception ignored) {}
                }
                ed.apply();
            } catch (Exception ignored) {}

            scheduleCccdEnableAttempt(gatt, hrChar, 0);
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            if (gatt != activeBleGatt) return;
            bleMainHandler.removeCallbacks(bleCccdConfirmFallbackRunnable);
            if (status == BluetoothGatt.GATT_SUCCESS) {
                bleHrState = "connected";
                bleHrErrorCode = "";
                emitBleHrStatusToWebView(null);
            } else if (bleCccdRetryAttempt < 4 && descriptor != null && descriptor.getCharacteristic() != null) {
                scheduleCccdEnableAttempt(gatt, descriptor.getCharacteristic(), bleCccdRetryAttempt + 1);
                return;
            } else {
                bleHrState = "connected";
                bleHrErrorCode = "";
                emitBleHrStatusToWebView(null);
            }
            // Read optional Battery Level (0x180F -> 0x2A19) only AFTER CCCD descriptor write completes
            try {
                BluetoothGattService battService = gatt.getService(BLE_BATTERY_SERVICE_UUID);
                if (battService != null) {
                    BluetoothGattCharacteristic battChar = battService.getCharacteristic(BLE_BATTERY_LEVEL_UUID);
                    if (battChar != null) {
                        gatt.readCharacteristic(battChar);
                    }
                }
            } catch (Exception ignored) {}
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (gatt != activeBleGatt) return;
            if (characteristic != null && BLE_HR_MEASUREMENT_UUID.equals(characteristic.getUuid()) && value != null) {
                bleMainHandler.removeCallbacks(bleConnectTimeoutRunnable);
                bleMainHandler.removeCallbacks(bleCccdConfirmFallbackRunnable);
                if (!"connected".equals(bleHrState)) {
                    bleHrState = "connected";
                    bleHrErrorCode = "";
                }
                emitBleHrStatusToWebView(value);
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (gatt != activeBleGatt) return;
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && characteristic != null) {
                if (BLE_HR_MEASUREMENT_UUID.equals(characteristic.getUuid())) {
                    byte[] val = characteristic.getValue();
                    if (val != null) {
                        bleMainHandler.removeCallbacks(bleConnectTimeoutRunnable);
                        bleMainHandler.removeCallbacks(bleCccdConfirmFallbackRunnable);
                        if (!"connected".equals(bleHrState)) {
                            bleHrState = "connected";
                            bleHrErrorCode = "";
                        }
                        emitBleHrStatusToWebView(val);
                    }
                }
            }
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value, int status) {
            if (gatt != activeBleGatt) return;
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic != null && value != null) {
                if (BLE_BATTERY_LEVEL_UUID.equals(characteristic.getUuid()) && value.length >= 1) {
                    int pct = value[0] & 0xFF;
                    if (pct >= 0 && pct <= 100) {
                        bleBatteryPct = pct;
                        emitBleHrStatusToWebView(null);
                    }
                } else if (BLE_HR_MEASUREMENT_UUID.equals(characteristic.getUuid()) && value.length >= 2) {
                    if (!"connected".equals(bleHrState)) {
                        bleHrState = "connected";
                        bleHrErrorCode = "";
                    }
                    emitBleHrStatusToWebView(value);
                }
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            if (gatt != activeBleGatt) return;
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && status == BluetoothGatt.GATT_SUCCESS &&
                characteristic != null) {
                byte[] val = characteristic.getValue();
                if (val != null) {
                    if (BLE_BATTERY_LEVEL_UUID.equals(characteristic.getUuid()) && val.length >= 1) {
                        int pct = val[0] & 0xFF;
                        if (pct >= 0 && pct <= 100) {
                            bleBatteryPct = pct;
                            emitBleHrStatusToWebView(null);
                        }
                    } else if (BLE_HR_MEASUREMENT_UUID.equals(characteristic.getUuid()) && val.length >= 2) {
                        if (!"connected".equals(bleHrState)) {
                            bleHrState = "connected";
                            bleHrErrorCode = "";
                        }
                        emitBleHrStatusToWebView(val);
                    }
                }
            }
        }
    };

    @SuppressLint("MissingPermission")
    private void connectBleHrDeviceInternal(String address, String name, boolean autoConnect) {
        if (address == null || address.trim().isEmpty()) return;
        final String cleanAddr = address.trim();
        final String cleanName = (name != null && !name.trim().isEmpty()) ? name.trim() : "Sensor Bluetooth";

        if (!hasBlePermissionsInternal()) {
            pendingBleConnectAddress = cleanAddr;
            pendingBleConnectName = cleanName;
            requestBlePermissionsInternal(2);
            return;
        }

        final BluetoothAdapter adapter = getBleAdapterInternal();
        if (adapter == null || !adapter.isEnabled()) {
            bleHrState = "error";
            bleHrErrorCode = "BLUETOOTH_OFF";
            emitBleHrStatusToWebView(null);
            return;
        }

        if (pendingConnectAfterStopScanRunnable != null) {
            bleMainHandler.removeCallbacks(pendingConnectAfterStopScanRunnable);
            pendingConnectAfterStopScanRunnable = null;
        }
        bleMainHandler.removeCallbacks(bleReconnectRunnable);
        bleMainHandler.removeCallbacks(bleConnectTimeoutRunnable);
        boolean wasActivelyScanning = isBleScanning || "scanning".equals(bleHrState);
        stopBleHrScanInternal();
        if (!cleanAddr.equals(bleHrDeviceId)) {
            bleConnectRetryCount = 0;
            bleConnectedOnce = false;
        }
        bleBatteryPct = null;
        bleUserRequestedDisconnect = false;
        bleGattCacheRefreshTried = false;
        bleCccdRetryAttempt = 0;
        bleHrDeviceId = cleanAddr;
        bleHrDeviceName = cleanName;
        bleHrErrorCode = "";
        bleHrState = autoConnect ? "reconnecting" : "connecting";
        emitBleHrStatusToWebView(null);

        if (activeBleGatt != null) {
            BluetoothGatt oldGatt = activeBleGatt;
            activeBleGatt = null;
            try {
                oldGatt.disconnect();
                oldGatt.close();
            } catch (Exception ignored) {}
        }

        final int currentRetry = bleConnectRetryCount;
        Runnable doConnect = () -> {
            pendingConnectAfterStopScanRunnable = null;
            if (bleUserRequestedDisconnect) return;
            try {
                BluetoothDevice device = resolveBleRemoteDevice(adapter, cleanAddr, currentRetry);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    activeBleGatt = device.connectGatt(MainActivity.this, autoConnect, bleHrGattCallback, BluetoothDevice.TRANSPORT_LE);
                } else {
                    activeBleGatt = device.connectGatt(MainActivity.this, autoConnect, bleHrGattCallback);
                }
                if (!autoConnect) {
                    bleMainHandler.postDelayed(bleConnectTimeoutRunnable, 12000L);
                }
            } catch (Exception e) {
                bleHrState = "error";
                bleHrErrorCode = "CONNECT_FAILED";
                emitBleHrStatusToWebView(null);
            }
        };

        // Give the BLE radio 160ms to exit scan state cleanly before initiating LE_Create_Connection (prevents GATT 133)
        if (wasActivelyScanning && !autoConnect) {
            pendingConnectAfterStopScanRunnable = doConnect;
            bleMainHandler.postDelayed(doConnect, 160L);
        } else {
            doConnect.run();
        }
    }

    @SuppressLint("MissingPermission")
    private void disconnectBleHrDeviceInternal(boolean forgetSaved) {
        bleUserRequestedDisconnect = true;
        isBleGattConnected = false;
        bleConnectedOnce = false;
        bleConnectRetryCount = 0;
        bleAutoReconnectAttempts = 0;
        if (pendingConnectAfterStopScanRunnable != null) {
            bleMainHandler.removeCallbacks(pendingConnectAfterStopScanRunnable);
            pendingConnectAfterStopScanRunnable = null;
        }
        bleMainHandler.removeCallbacks(bleReconnectRunnable);
        bleMainHandler.removeCallbacks(bleConnectTimeoutRunnable);
        bleMainHandler.removeCallbacks(bleCccdConfirmFallbackRunnable);
        stopBleHrScanInternal();
        if (activeBleGatt != null) {
            BluetoothGatt oldGatt = activeBleGatt;
            activeBleGatt = null;
            try {
                oldGatt.disconnect();
                oldGatt.close();
            } catch (Exception ignored) {}
        }
        bleBatteryPct = null;
        bleHrErrorCode = "";
        bleHrState = "disconnected";
        if (forgetSaved) {
            bleHrDeviceId = "";
            bleHrDeviceName = "";
            try {
                getSharedPreferences(BLE_HR_PREFS, MODE_PRIVATE).edit().clear().apply();
            } catch (Exception ignored) {}
        }
        emitBleHrStatusToWebView(null);
    }

    private void emitWearHeartRateToWebView(final String payload, final String sourceNodeId) {
        try {
            JSONObject in = new JSONObject(payload);
            JSONObject out = new JSONObject();
            out.put("bpm", in.optInt("bpm", 0));
            out.put("status", in.optString("status", "ok"));
            out.put("deviceName", in.optString("deviceName", ""));
            out.put("nodeId", sourceNodeId != null ? sourceNodeId : "");
            final String quotedJson = JSONObject.quote(out.toString());
            runOnUiThread(() -> {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    String js = "if (window.__onNativeWearHrUpdate) { window.__onNativeWearHrUpdate(" + quotedJson + "); }";
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            });
        } catch (Exception ignored) {}
    }

    /** Clears Android's cached GATT service table (hidden API) so freshly enabled pulse broadcast is discovered. */
    private boolean refreshBleGattCacheInternal(BluetoothGatt gatt) {
        if (gatt == null) return false;
        try {
            java.lang.reflect.Method refresh = gatt.getClass().getMethod("refresh");
            Object res = refresh.invoke(gatt);
            return res instanceof Boolean && (Boolean) res;
        } catch (Exception ignored) {
            return false;
        }
    }

    private volatile boolean bleGattCacheRefreshTried = false;

    @Keep
    public class ArcheryBleHeartRateBridge {
        @Keep
        @JavascriptInterface
        public void requestWatchHeartRate() {
            try {
                byte[] req = ("{\"type\":\"HR_REQUEST\",\"_ts\":" + System.currentTimeMillis() + "}")
                    .getBytes(StandardCharsets.UTF_8);
                broadcastToWearNodes("/archery101010/hr_request", req);
            } catch (Exception ignored) {}
        }

        @Keep
        @JavascriptInterface
        public void startScan() {
            runOnUiThread(() -> startBleHrScanInternal());
        }

        @Keep
        @JavascriptInterface
        public void stopScan() {
            runOnUiThread(() -> stopBleHrScanInternal());
        }

        @Keep
        @JavascriptInterface
        public void connectDevice(final String address, final String name) {
            runOnUiThread(() -> {
                bleConnectRetryCount = 0;
                bleAutoReconnectAttempts = 0;
                connectBleHrDeviceInternal(address, name, false);
            });
        }

        @Keep
        @JavascriptInterface
        public void disconnectDevice(final boolean forgetSaved) {
            runOnUiThread(() -> disconnectBleHrDeviceInternal(forgetSaved));
        }

        @Keep
        @JavascriptInterface
        public void tryAutoReconnectSaved() {
            runOnUiThread(() -> {
                if ("connected".equals(bleHrState) || "connecting".equals(bleHrState)) return;
                if (!hasBlePermissionsInternal()) return;
                BluetoothAdapter adapter = getBleAdapterInternal();
                if (adapter == null || !adapter.isEnabled()) return;
                String savedAddr = getSharedPreferences(BLE_HR_PREFS, MODE_PRIVATE).getString("saved_address", "");
                String savedName = getSharedPreferences(BLE_HR_PREFS, MODE_PRIVATE).getString("saved_name", "");
                if (savedAddr != null && !savedAddr.isEmpty()) {
                    connectBleHrDeviceInternal(savedAddr, savedName, true);
                }
            });
        }

        @Keep
        @JavascriptInterface
        public String getStatusJson() {
            try {
                if ((bleHrDeviceId == null || bleHrDeviceId.isEmpty())) {
                    String savedAddr = getSharedPreferences(BLE_HR_PREFS, MODE_PRIVATE).getString("saved_address", "");
                    String savedName = getSharedPreferences(BLE_HR_PREFS, MODE_PRIVATE).getString("saved_name", "");
                    if (savedAddr != null && !savedAddr.isEmpty()) {
                        bleHrDeviceId = savedAddr;
                        bleHrDeviceName = savedName != null ? savedName : "";
                    }
                }
            } catch (Exception ignored) {}
            return buildBleHrStatusJsonObject(null).toString();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        activeInstanceRef = new WeakReference<>(this);
        flushPendingWatchCommandsToWebView();
        refreshWatchConnectionStatus();
    }

    @Override
    public void onDestroy() {
        cancelOtaWatchdog();
        if (activeInstanceRef != null && activeInstanceRef.get() == this) {
            activeInstanceRef = new WeakReference<>(null);
        }
        isSessionTrackingActive = false;
        try {
            bleUserRequestedDisconnect = true;
            bleMainHandler.removeCallbacks(bleReconnectRunnable);
            bleMainHandler.removeCallbacks(bleConnectTimeoutRunnable);
            stopBleHrScanInternal();
            if (activeBleGatt != null) {
                activeBleGatt.disconnect();
                activeBleGatt.close();
                activeBleGatt = null;
            }
        } catch (Exception ignored) {}
        try {
            if (spotifyRemote != null) {
                SpotifyAppRemote.disconnect(spotifyRemote); // music keeps playing in the Spotify engine
                spotifyRemote = null;
            }
        } catch (Exception ignored) {}
        try {
            if (nativeLocationManager != null) {
                nativeLocationManager.removeUpdates(nativeLocationListener);
            }
        } catch (Exception ignored) {}
        try {
            if (nativeSensorManager != null) {
                nativeSensorManager.unregisterListener(nativeStepSensorListener);
            }
        } catch (Exception ignored) {}
        try {
            if (wearMessageListener != null) {
                Wearable.getMessageClient(this).removeListener(wearMessageListener);
                wearMessageListener = null;
            }
        } catch (Exception ignored) {}
        try {
            if (wearDataListener != null) {
                Wearable.getDataClient(this).removeListener(wearDataListener);
                wearDataListener = null;
            }
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
