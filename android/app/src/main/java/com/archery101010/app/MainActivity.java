package com.archery101010.app;

import android.Manifest;
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
import android.net.Uri;
import android.os.Bundle;
import android.os.Looper;
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
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
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

    private ActivityResultLauncher<Intent> googleSignInLauncher;
    private ActivityResultLauncher<String[]> locationPermissionLauncher;
    private ActivityResultLauncher<String> audioPermissionLauncher;
    private ActivityResultLauncher<Intent> cameraCaptureLauncher;
    private PermissionRequest pendingWebAudioPermissionRequest = null;
    private File pendingCameraCaptureFile = null;
    private volatile String activeAppOrigin = "https://localhost";
    private volatile boolean isWebWatchListenerReady = false;

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
            initWearableListener();

            if (getSharedPreferences("archery_ota_prefs", MODE_PRIVATE).getBoolean("prefer_remote_ota", false)) {
                activeAppOrigin = "https://archery101010-c0bb4.web.app";
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
                        Intent dlIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
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
                    }
                    super.onPageStarted(view, url, favicon);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    flushPendingWatchCommandsToWebView();
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                    if (request != null && request.isForMainFrame() && request.getUrl() != null) {
                        String host = request.getUrl().getHost();
                        if (host != null && host.contains("archery101010-c0bb4.web.app")) {
                            activeAppOrigin = "https://localhost";
                            view.loadUrl("https://localhost/");
                            return;
                        }
                    }
                    super.onReceivedError(view, request, error);
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
                                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
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
        public void reloadInAppOta() {
            runOnUiThread(() -> {
                try {
                    getSharedPreferences("archery_ota_prefs", MODE_PRIVATE)
                        .edit()
                        .putBoolean("prefer_remote_ota", true)
                        .apply();
                    activeAppOrigin = "https://archery101010-c0bb4.web.app";
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        WebView wv = getBridge().getWebView();
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
                state.put("sessionActive", true);

                String practiceType = state.optString("practiceType", "Práctica");
                if (!"Volumen".equalsIgnoreCase(practiceType) && delta > 0) {
                    for (int i = 0; i < delta; i++) {
                        if (curEndArrows.length() >= arrowsPerEnd) {
                            if (curEndIdx < endsCount - 1) {
                                curEndIdx++;
                                curEndArrows = new JSONArray();
                            } else {
                                break;
                            }
                        }
                        curEndArrows.put("10");
                        state.put("totalScore", Math.max(0, state.optInt("totalScore", 0) + 10));
                    }
                    state.put("currentEndIndex", curEndIdx);
                    state.put("currentEndArrows", curEndArrows);
                }
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
                try {
                    if (spotifyUri != null && !spotifyUri.isEmpty() && isSpotifyAppInstalledInternal()) {
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(spotifyUri));
                        i.setPackage("com.spotify.music");
                        i.putExtra(Intent.EXTRA_REFERRER, Uri.parse("android-app://" + getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    }
                } catch (Exception ignored) {}
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

    @Override
    public void onResume() {
        super.onResume();
        activeInstanceRef = new WeakReference<>(this);
        flushPendingWatchCommandsToWebView();
        refreshWatchConnectionStatus();
    }

    @Override
    public void onDestroy() {
        if (activeInstanceRef != null && activeInstanceRef.get() == this) {
            activeInstanceRef = new WeakReference<>(null);
        }
        isSessionTrackingActive = false;
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
