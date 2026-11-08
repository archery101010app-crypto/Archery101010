package com.archery101010.app;

import android.Manifest;
import android.app.Dialog;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Looper;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
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
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String GOOGLE_WEB_CLIENT_ID =
        "757910399585-q71dprgcodk5s2t67965gdfusr1lv441.apps.googleusercontent.com";
    private static final String WATCH_BRIDGE_PREFS = "archery_watch_bridge_prefs";
    private static final String SPOTIFY_PREFS = "archery_spotify_prefs";
    private static final String DESKTOP_CHROME_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    private ActivityResultLauncher<Intent> googleSignInLauncher;
    private ActivityResultLauncher<String[]> locationPermissionLauncher;
    private volatile String activeAppOrigin = "https://localhost";
    private Dialog spotifyLoginDialog = null;

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

    private final LocationListener nativeLocationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location loc) {
            if (!isSessionTrackingActive || loc == null) return;
            if (loc.hasAccuracy() && loc.getAccuracy() > 35f) {
                return;
            }
            long now = System.currentTimeMillis();
            boolean isHighAccuracyFix =
                "gps".equalsIgnoreCase(loc.getProvider()) ||
                (loc.hasAccuracy() && loc.getAccuracy() <= 18f);
            if (isHighAccuracyFix) {
                lastHighAccuracyGpsTimeMs = now;
            } else if (
                lastHighAccuracyGpsTimeMs > 0L &&
                (now - lastHighAccuracyGpsTimeMs) <= 20000L &&
                "network".equalsIgnoreCase(loc.getProvider()) &&
                (!loc.hasAccuracy() || loc.getAccuracy() > 20f)
            ) {
                // Ignore coarse cell/Wi-Fi network jump while satellite/high-accuracy GPS was active recently
                return;
            }

            if (lastValidGpsLocation != null) {
                float deltaM = loc.distanceTo(lastValidGpsLocation);
                long dtMs = Math.max(1L, now - lastGpsFixTimeMs);
                float speedMs = (deltaM * 1000f) / dtMs;
                if (deltaM > 50f || speedMs > 8.5f) {
                    // Update anchor on coarse-to-fine GPS jump or signal recovery so it never freezes permanently
                    lastValidGpsLocation = loc;
                    lastGpsFixTimeMs = now;
                    hasGpsFix = true;
                    return;
                }
                float minDeltaM = Math.max(1.5f, loc.hasAccuracy() ? loc.getAccuracy() * 0.22f : 1.5f);
                if (deltaM >= minDeltaM) {
                    accumulatedGpsDistanceM += deltaM;
                    sessionAccumulatedMeters = Math.max(accumulatedGpsDistanceM, accumulatedSteps * 0.76);
                    lastValidGpsLocation = loc;
                    lastGpsFixTimeMs = now;
                    hasGpsFix = true;
                    emitLocationSnapshot();
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
        private double smoothedMag = 9.81;

        @Override
        public void onSensorChanged(SensorEvent event) {
            if (!isSessionTrackingActive || event == null || event.values == null) return;
            float ax = event.values[0];
            float ay = event.values[1];
            float az = event.values[2];
            double mag = Math.sqrt(ax * ax + ay * ay + az * az);
            double dynamicLinear = mag - smoothedMag;
            smoothedMag = 0.96 * smoothedMag + 0.04 * mag;
            long now = System.currentTimeMillis();
            // Real walking step waveform detection (zero health permissions required)
            if (dynamicLinear >= 1.15 && dynamicLinear <= 14.0 && (now - lastStepDetectedTimeMs) >= 350L) {
                lastStepDetectedTimeMs = now;
                accumulatedSteps += 1;
                sessionAccumulatedMeters = Math.max(accumulatedGpsDistanceM, accumulatedSteps * 0.76);
                emitLocationSnapshot();
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

        super.onCreate(savedInstanceState);

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

            webView.addJavascriptInterface(new ArcheryNativeAuth(), "ArcheryNativeAuth");
            webView.addJavascriptInterface(new ArcheryNativeShare(), "ArcheryNativeShare");
            webView.addJavascriptInterface(new ArcheryWatchNativeBridge(), "ArcheryWatchNativeBridge");
            webView.addJavascriptInterface(new ArcheryLocationNativeBridge(), "ArcheryLocationNativeBridge");
            webView.addJavascriptInterface(new ArcherySpotifyBridge(), "ArcherySpotifyBridge");
            restoreAndPromoteSpotifyCookies();
            initWearableListener();

            if (getSharedPreferences("archery_ota_prefs", MODE_PRIVATE).getBoolean("prefer_remote_ota", false)) {
                activeAppOrigin = "https://archery101010-c0bb4.web.app";
                webView.loadUrl("https://archery101010-c0bb4.web.app/");
            }

            getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
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
                        if (host.equals("open.spotify.com") && path.startsWith("/embed/") &&
                            (request.getMethod() == null || "GET".equalsIgnoreCase(request.getMethod()))) {
                            WebResourceResponse spotifyRes = interceptSpotifyEmbedRequest(uri.toString());
                            if (spotifyRes != null) {
                                return spotifyRes;
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
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if (uri != null) {
                        String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                        String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
                        String path = uri.getPath() != null ? uri.getPath().toLowerCase() : "";
                        if (path.endsWith(".apk") || path.endsWith(".aab") || path.equals("/download-apk")) {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                                return true;
                            } catch (Exception ignored) {}
                        }
                        if (scheme.equals("whatsapp") || host.equals("api.whatsapp.com") || host.equals("wa.me")) {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                                return true;
                            } catch (Exception ignored) {}
                        }
                        if (!host.isEmpty()) {
                            if (host.equals("accounts.google.com") ||
                                host.endsWith(".google.com") ||
                                host.endsWith(".googleusercontent.com") ||
                                host.endsWith(".gstatic.com") ||
                                host.endsWith(".youtube.com") ||
                                host.equals("accounts.spotify.com") ||
                                host.equals("open.spotify.com") ||
                                host.endsWith(".spotify.com") ||
                                host.equals("archery101010-c0bb4.firebaseapp.com") ||
                                host.equals("archery101010-c0bb4.web.app")) {
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

    public class ArcheryNativeAuth {
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
    }

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
    }

    public class ArcheryWatchNativeBridge {
        @JavascriptInterface
        public void onSessionTelemetryUpdate(final String snapshotJson) {
            cacheAndSyncWatchState(snapshotJson);
        }

        @JavascriptInterface
        public void syncTelemetryToWatch(final String snapshotJson) {
            cacheAndSyncWatchState(snapshotJson);
        }

        @JavascriptInterface
        public void sendWatchCommand(final String cmdJson) {
            byte[] bytes = cmdJson != null ? cmdJson.getBytes(StandardCharsets.UTF_8) : new byte[0];
            broadcastToWearNodes("/archery101010/command", bytes);
            if (cmdJson != null && cmdJson.contains("\"STATE_UPDATE\"")) {
                cacheAndSyncWatchState(cmdJson);
            }
        }

        @JavascriptInterface
        public String getWatchConnectionStatus() {
            flushPendingWatchCommandsToWebView();
            refreshWatchConnectionStatus();
            return buildWatchConnectionStatusJson();
        }

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

        @JavascriptInterface
        public void flushPendingWatchCommands() {
            flushPendingWatchCommandsToWebView();
        }
    }

    public class ArcheryLocationNativeBridge {
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
                state.put("autoDetectEnabled", cmdObj.optBoolean("enabled", true));
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
            JSONObject status = new JSONObject();
            status.put("bridgeReady", true);
            status.put("nativeVersion", "2.64");
            status.put("connectedNodesCount", cachedConnectedNodesJson.length());
            status.put("connectedNodes", cachedConnectedNodesJson);
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
                    "(function() { if (typeof window.__onNativeWatchMessage === 'function') { window.__onNativeWatchMessage(" +
                    safePayload +
                    "); return 'DELIVERED'; } return 'PENDING'; })()";
                getBridge().getWebView().evaluateJavascript(js, result -> {
                    if (result == null || !result.contains("DELIVERED")) {
                        if (!"REQUEST_STATE".equals(finalCmdType)) {
                            synchronized (pendingWatchCommands) {
                                if (pendingWatchCommands.size() < 60) {
                                    pendingWatchCommands.add(payload);
                                }
                            }
                        }
                    }
                });
            } else if (!"REQUEST_STATE".equals(finalCmdType)) {
                synchronized (pendingWatchCommands) {
                    if (pendingWatchCommands.size() < 60) {
                        pendingWatchCommands.add(payload);
                    }
                }
            }
        });
    }

    private void flushPendingWatchCommandsToWebView() {
        final List<String> toFlush;
        synchronized (pendingWatchCommands) {
            if (pendingWatchCommands.isEmpty()) return;
            toFlush = new ArrayList<>(pendingWatchCommands);
            pendingWatchCommands.clear();
        }
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                for (String cmdPayload : toFlush) {
                    String safePayload = JSONObject.quote(cmdPayload);
                    String js = "if (typeof window.__onNativeWatchMessage === 'function') { window.__onNativeWatchMessage(" + safePayload + "); }";
                    getBridge().getWebView().evaluateJavascript(js, null);
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

    public class ArcherySpotifyBridge {
        @JavascriptInterface
        public void openSpotifyLogin() {
            runOnUiThread(() -> showInAppSpotifyLoginDialog());
        }

        @JavascriptInterface
        public boolean hasActiveSpotifySession() {
            return hasActiveSpotifySessionInternal();
        }

        @JavascriptInterface
        public void clearSpotifySession() {
            try {
                getSharedPreferences(SPOTIFY_PREFS, MODE_PRIVATE).edit().clear().apply();
                CookieManager cm = CookieManager.getInstance();
                cm.setCookie("https://open.spotify.com", "sp_dc=; Domain=.spotify.com; Path=/; Max-Age=0; Secure; SameSite=None");
                cm.setCookie("https://accounts.spotify.com", "sp_dc=; Domain=.spotify.com; Path=/; Max-Age=0; Secure; SameSite=None");
                cm.flush();
            } catch (Exception ignored) {}
        }
    }

    private Map<String, String> collectSpotifyCookieMap() {
        Map<String, String> map = new LinkedHashMap<>();
        try {
            String savedAll = getSharedPreferences(SPOTIFY_PREFS, MODE_PRIVATE).getString("spotify_cookies", "");
            parseCookieStringIntoMap(savedAll, map);
            String savedSpDc = getSharedPreferences(SPOTIFY_PREFS, MODE_PRIVATE).getString("sp_dc", "");
            if (savedSpDc != null && !savedSpDc.isEmpty()) {
                map.put("sp_dc", savedSpDc);
            }
            CookieManager cm = CookieManager.getInstance();
            parseCookieStringIntoMap(cm.getCookie("https://accounts.spotify.com"), map);
            parseCookieStringIntoMap(cm.getCookie("https://open.spotify.com"), map);
        } catch (Exception ignored) {}
        return map;
    }

    private void parseCookieStringIntoMap(String rawCookieHeader, Map<String, String> target) {
        if (rawCookieHeader == null || rawCookieHeader.isEmpty()) return;
        String[] parts = rawCookieHeader.split(";");
        for (String part : parts) {
            String trimmed = part != null ? part.trim() : "";
            int eq = trimmed.indexOf('=');
            if (eq > 0) {
                String k = trimmed.substring(0, eq).trim();
                String v = trimmed.substring(eq + 1).trim();
                if (!k.isEmpty() && !v.isEmpty()) {
                    target.put(k, v);
                }
            }
        }
    }

    private String buildSpotifyCookieHeader() {
        Map<String, String> map = collectSpotifyCookieMap();
        if (map.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> entry : map.entrySet()) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(entry.getKey()).append("=").append(entry.getValue());
        }
        return sb.toString();
    }

    private boolean hasActiveSpotifySessionInternal() {
        Map<String, String> map = collectSpotifyCookieMap();
        String spDc = map.get("sp_dc");
        return spDc != null && spDc.length() > 10;
    }

    private void restoreAndPromoteSpotifyCookies() {
        captureAndPersistSpotifyCookies();
    }

    private boolean captureAndPersistSpotifyCookies() {
        try {
            Map<String, String> map = collectSpotifyCookieMap();
            if (map.isEmpty()) return false;
            String spDc = map.get("sp_dc");
            boolean hasSpDc = spDc != null && spDc.length() > 10;

            StringBuilder sb = new StringBuilder();
            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            for (Map.Entry<String, String> entry : map.entrySet()) {
                String k = entry.getKey();
                String v = entry.getValue();
                if (sb.length() > 0) sb.append("; ");
                sb.append(k).append("=").append(v);

                String cookieLine = k + "=" + v + "; Domain=.spotify.com; Path=/; Max-Age=31536000; Secure; SameSite=None" +
                    ("sp_dc".equals(k) ? "; HttpOnly" : "");
                cm.setCookie("https://open.spotify.com", cookieLine);
                cm.setCookie("https://accounts.spotify.com", cookieLine);
            }
            cm.flush();

            android.content.SharedPreferences.Editor editor = getSharedPreferences(SPOTIFY_PREFS, MODE_PRIVATE).edit();
            editor.putString("spotify_cookies", sb.toString());
            if (hasSpDc) {
                editor.putString("sp_dc", spDc);
            }
            editor.apply();
            return hasSpDc;
        } catch (Exception e) {
            return false;
        }
    }

    private void dispatchSpotifyLoginResult(final boolean connected) {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = "if (window.__onNativeSpotifyLoginSuccess) { window.__onNativeSpotifyLoginSuccess({ connected: " +
                    connected + ", hasSpDc: " + connected + " }); }";
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private void showInAppSpotifyLoginDialog() {
        try {
            if (spotifyLoginDialog != null && spotifyLoginDialog.isShowing()) {
                spotifyLoginDialog.dismiss();
            }
        } catch (Exception ignored) {}

        final Dialog dialog = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        spotifyLoginDialog = dialog;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0B0E14"));
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        int padH = dpToPx(14);
        int padV = dpToPx(10);
        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setBackgroundColor(Color.parseColor("#111620"));
        topBar.setPadding(padH, padV, padH, padV);

        TextView titleView = new TextView(this);
        titleView.setText("Conectar con Spotify · Se cerrará automáticamente");
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        topBar.addView(titleView, titleLp);

        TextView closeBtn = new TextView(this);
        closeBtn.setText("✕");
        closeBtn.setTextColor(Color.WHITE);
        closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        closeBtn.setTypeface(Typeface.DEFAULT_BOLD);
        closeBtn.setBackgroundColor(Color.parseColor("#1A2232"));
        closeBtn.setPadding(dpToPx(11), dpToPx(5), dpToPx(11), dpToPx(5));
        topBar.addView(closeBtn);

        root.addView(topBar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        final WebView loginWv = new WebView(this);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(loginWv, true);

        WebSettings ws = loginWv.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setUserAgentString(DESKTOP_CHROME_UA);

        final android.os.Handler autoWatchHandler = new android.os.Handler(Looper.getMainLooper());
        final boolean[] autoCompleted = new boolean[]{ false };

        final Runnable autoCompleteIfAuthenticated = () -> {
            if (autoCompleted[0]) return;
            if (captureAndPersistSpotifyCookies()) {
                autoCompleted[0] = true;
                autoWatchHandler.removeCallbacksAndMessages(null);
                try {
                    if (dialog.isShowing()) {
                        dialog.dismiss();
                    }
                } catch (Exception ignored) {}
                dispatchSpotifyLoginResult(true);
            }
        };

        final Runnable periodicCookieWatcher = new Runnable() {
            @Override
            public void run() {
                if (autoCompleted[0] || !dialog.isShowing()) return;
                autoCompleteIfAuthenticated.run();
                if (!autoCompleted[0] && dialog.isShowing()) {
                    autoWatchHandler.postDelayed(this, 350L);
                }
            }
        };

        loginWv.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    try {
                        request.grant(request.getResources());
                    } catch (Exception ignored) {}
                });
            }
        });

        loginWv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false;
                }
                // Block intent:// or spotify:// redirects so session stays inside WebView
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                autoCompleteIfAuthenticated.run();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                autoCompleteIfAuthenticated.run();
            }
        });

        dialog.setOnDismissListener(d -> {
            autoWatchHandler.removeCallbacksAndMessages(null);
        });

        closeBtn.setOnClickListener(v -> {
            autoWatchHandler.removeCallbacksAndMessages(null);
            boolean ok = captureAndPersistSpotifyCookies();
            try {
                dialog.dismiss();
            } catch (Exception ignored) {}
            dispatchSpotifyLoginResult(ok);
        });

        root.addView(loginWv, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));

        dialog.setContentView(root);
        dialog.show();
        autoWatchHandler.postDelayed(periodicCookieWatcher, 350L);

        String loginUrl = "https://accounts.spotify.com/es/login?continue=" +
            Uri.encode("https://open.spotify.com/");
        loginWv.loadUrl(loginUrl);
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private WebResourceResponse interceptSpotifyEmbedRequest(final String initialUrl) {
        HttpURLConnection conn = null;
        try {
            captureAndPersistSpotifyCookies();
            String cookieHeader = buildSpotifyCookieHeader();
            String currentUrl = initialUrl;

            for (int hop = 0; hop < 4; hop++) {
                URL url = new URL(currentUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setRequestProperty("User-Agent", DESKTOP_CHROME_UA);
                conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                conn.setRequestProperty("Accept-Language", "es-ES,es;q=0.9,en;q=0.8");
                if (cookieHeader != null && !cookieHeader.isEmpty()) {
                    conn.setRequestProperty("Cookie", cookieHeader);
                }

                int status = conn.getResponseCode();
                Map<String, List<String>> headers = conn.getHeaderFields();
                if (headers != null) {
                    CookieManager cm = CookieManager.getInstance();
                    for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                        if (entry.getKey() != null && "set-cookie".equalsIgnoreCase(entry.getKey()) && entry.getValue() != null) {
                            for (String sc : entry.getValue()) {
                                if (sc != null && !sc.isEmpty()) {
                                    cm.setCookie("https://open.spotify.com", sc);
                                }
                            }
                        }
                    }
                }

                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (location == null || location.isEmpty()) break;
                    if (location.startsWith("/")) {
                        currentUrl = "https://open.spotify.com" + location;
                    } else {
                        currentUrl = location;
                    }
                    cookieHeader = buildSpotifyCookieHeader();
                    continue;
                }
                break;
            }

            if (conn == null || conn.getResponseCode() != 200) {
                return null;
            }

            InputStream is = conn.getInputStream();
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            is.close();

            String html = new String(baos.toByteArray(), StandardCharsets.UTF_8);
            html = html
                .replace("\"isMobile\":true", "\"isMobile\":false")
                .replace("\"isTablet\":true", "\"isTablet\":false")
                .replace("\"isIOS\":true", "\"isIOS\":false")
                .replace("\"isSafari\":true", "\"isSafari\":false");

            String desktopAndEmeShim =
                "<script>" +
                "try{" +
                "var _dUa='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';" +
                "Object.defineProperty(navigator,'userAgent',{get:function(){return _dUa;},configurable:true});" +
                "Object.defineProperty(navigator,'appVersion',{get:function(){return '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';},configurable:true});" +
                "Object.defineProperty(navigator,'platform',{get:function(){return 'Win32';},configurable:true});" +
                "Object.defineProperty(navigator,'maxTouchPoints',{get:function(){return 0;},configurable:true});" +
                "Object.defineProperty(navigator,'userAgentData',{get:function(){return{brands:[{brand:'Chromium',version:'131'},{brand:'Google Chrome',version:'131'}],mobile:false,platform:'Windows',getHighEntropyValues:function(){return Promise.resolve({architecture:'x86',bitness:'64',mobile:false,model:'',platform:'Windows',platformVersion:'15.0.0',uaFullVersion:'131.0.0.0'});}};},configurable:true});" +
                "if(navigator.requestMediaKeySystemAccess){" +
                "var _origRMKSA=navigator.requestMediaKeySystemAccess.bind(navigator);" +
                "navigator.requestMediaKeySystemAccess=function(ks,cfgs){" +
                "return _origRMKSA(ks,cfgs).catch(function(){" +
                "var c1=(cfgs||[]).map(function(c){var x=Object.assign({},c);x.distinctiveIdentifier='optional';x.persistentState='optional';if(Array.isArray(x.audioCapabilities)){x.audioCapabilities=x.audioCapabilities.map(function(a){return{contentType:a.contentType,robustness:'SW_SECURE_CRYPTO'};});}return x;});" +
                "return _origRMKSA(ks,c1).catch(function(){" +
                "var c2=(cfgs||[]).map(function(c){var x=Object.assign({},c);if(Array.isArray(x.audioCapabilities)){x.audioCapabilities=x.audioCapabilities.map(function(a){return{contentType:a.contentType};});}if(Array.isArray(x.videoCapabilities)){x.videoCapabilities=x.videoCapabilities.map(function(v){return{contentType:v.contentType};});}return x;});" +
                "return _origRMKSA(ks,c2);" +
                "});" +
                "});" +
                "};" +
                "}" +
                "}catch(e){}" +
                "</script>";

            int headIdx = html.indexOf("<head");
            if (headIdx != -1) {
                int headClose = html.indexOf(">", headIdx);
                if (headClose != -1) {
                    html = html.substring(0, headClose + 1) + desktopAndEmeShim + html.substring(headClose + 1);
                }
            }

            return new WebResourceResponse(
                "text/html",
                "UTF-8",
                new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8))
            );
        } catch (Exception e) {
            return null;
        } finally {
            try {
                if (conn != null) conn.disconnect();
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        flushPendingWatchCommandsToWebView();
        refreshWatchConnectionStatus();
    }

    @Override
    public void onDestroy() {
        isSessionTrackingActive = false;
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
