package com.archery101010.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
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
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String GOOGLE_WEB_CLIENT_ID =
        "757910399585-q71dprgcodk5s2t67965gdfusr1lv441.apps.googleusercontent.com";

    private ActivityResultLauncher<Intent> googleSignInLauncher;
    private ActivityResultLauncher<Intent> googleSignInFallbackLauncher;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        googleSignInFallbackLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                Intent data = result.getData();
                Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
                try {
                    GoogleSignInAccount account = task.getResult(ApiException.class);
                    sendAccountSuccess(account);
                } catch (ApiException e) {
                    sendAccountError(e.getStatusCode(), e.getMessage());
                } catch (Exception ex) {
                    sendAccountError(-1, ex.getMessage());
                }
            }
        );

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
                    if (code == 10 || code == 12500) {
                        // Fallback to basic profile/email sign-in if OAuth client SHA-1 is still propagating
                        try {
                            GoogleSignInOptions basicGso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                                .requestEmail()
                                .requestProfile()
                                .build();
                            GoogleSignInClient basicClient = GoogleSignIn.getClient(MainActivity.this, basicGso);
                            googleSignInFallbackLauncher.launch(basicClient.getSignInIntent());
                            return;
                        } catch (Exception fallbackEx) {
                            sendAccountError(code, e.getMessage());
                            return;
                        }
                    }
                    sendAccountError(code, e.getMessage());
                } catch (Exception ex) {
                    sendAccountError(-1, ex.getMessage());
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
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
            String defaultUa = settings.getUserAgentString();
            if (defaultUa != null) {
                String cleanUa = defaultUa.replace("; wv", "").replace("Version/4.0 ", "");
                settings.setUserAgentString(cleanUa);
            }

            webView.addJavascriptInterface(new ArcheryNativeAuth(), "ArcheryNativeAuth");

            getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if (uri != null) {
                        String urlStr = uri.toString();
                        if (urlStr.startsWith("https://archery101010-c0bb4.firebaseapp.com/__/auth/handler") ||
                            urlStr.startsWith("https://archery101010-c0bb4.web.app/__/auth/handler")) {
                            String html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script>" +
                                "window.location.replace('https://localhost/' + window.location.search + window.location.hash);" +
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
                    if (uri != null && uri.getHost() != null) {
                        String host = uri.getHost().toLowerCase();
                        if (host.equals("accounts.google.com") ||
                            host.endsWith(".google.com") ||
                            host.endsWith(".googleusercontent.com") ||
                            host.endsWith(".gstatic.com") ||
                            host.endsWith(".youtube.com") ||
                            host.equals("facebook.com") ||
                            host.endsWith(".facebook.com") ||
                            host.endsWith(".fbcdn.net") ||
                            host.equals("archery101010-c0bb4.firebaseapp.com") ||
                            host.equals("archery101010-c0bb4.web.app")) {
                            return false;
                        }
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }
            });
        }

        // Ensure Android WebView respects system window insets (status bar, navigation bar, cutouts)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (view, insets) -> {
            androidx.core.graphics.Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return insets;
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

    public class ArcheryNativeAuth {
        @JavascriptInterface
        public void startGoogleSignIn() {
            runOnUiThread(() -> {
                try {
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
}
