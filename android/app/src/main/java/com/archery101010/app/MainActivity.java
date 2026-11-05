package com.archery101010.app;

import android.Manifest;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
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
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String GOOGLE_WEB_CLIENT_ID =
        "757910399585-q71dprgcodk5s2t67965gdfusr1lv441.apps.googleusercontent.com";

    private ActivityResultLauncher<Intent> googleSignInLauncher;
    private ActivityResultLauncher<String[]> locationPermissionLauncher;
    private volatile String activeAppOrigin = "https://localhost";

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
            initWearableListener();

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
            broadcastToWearNodes("/archery101010/telemetry", snapshotJson != null ? snapshotJson.getBytes(StandardCharsets.UTF_8) : new byte[0]);
        }

        @JavascriptInterface
        public void syncTelemetryToWatch(final String snapshotJson) {
            broadcastToWearNodes("/archery101010/telemetry", snapshotJson != null ? snapshotJson.getBytes(StandardCharsets.UTF_8) : new byte[0]);
        }

        @JavascriptInterface
        public void sendWatchCommand(final String cmdJson) {
            broadcastToWearNodes("/archery101010/command", cmdJson != null ? cmdJson.getBytes(StandardCharsets.UTF_8) : new byte[0]);
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

    private void broadcastToWearNodes(final String path, final byte[] data) {
        try {
            Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                if (nodes != null) {
                    for (Node node : nodes) {
                        Wearable.getMessageClient(this).sendMessage(node.getId(), path, data);
                    }
                }
            });
        } catch (Exception ignored) {}
    }

    private void initWearableListener() {
        try {
            if (wearMessageListener != null) {
                Wearable.getMessageClient(this).removeListener(wearMessageListener);
            }
            wearMessageListener = (MessageEvent event) -> {
                if (event == null || event.getPath() == null) return;
                String path = event.getPath();
                if (path.startsWith("/archery101010/")) {
                    String payload = new String(event.getData(), StandardCharsets.UTF_8);
                    runOnUiThread(() -> {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            String safePayload = JSONObject.quote(payload);
                            String js = "if (window.__onNativeWatchMessage) { window.__onNativeWatchMessage(" + safePayload + "); }";
                            getBridge().getWebView().evaluateJavascript(js, null);
                        }
                    });
                }
            };
            Wearable.getMessageClient(this).addListener(wearMessageListener);
        } catch (Exception ignored) {}
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
        super.onDestroy();
    }
}
