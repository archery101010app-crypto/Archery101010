package com.archery101010.app;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configure WebView for seamless OAuth (Google/Facebook), Spotify playback, and session cookies
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
        // so content has the same natural breathing room and margins as the web browser version.
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (view, insets) -> {
            androidx.core.graphics.Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return insets;
        });
    }
}
