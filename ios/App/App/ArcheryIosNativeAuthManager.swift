import UIKit
import WebKit
import AuthenticationServices
import CryptoKit
import Security

/// Native iOS Authentication Bridge for ARCHERY 101010 (`AUD-IOS-03`).
/// - Runs OAuth 2.0 (`startGoogleSignIn`, `openOAuthSession`) via `ASWebAuthenticationSession`
///   outside embedded `WKWebView` so OAuth providers never block with `403 disallowed_useragent`
///   and local origin storage (`capacitor://localhost`) is never lost.
/// - Runs Native Sign in with Apple (`startAppleSignIn`) via `ASAuthorizationAppleIDProvider`
///   & `ASAuthorizationController` for App Store Guideline 4.8 compliance.
/// - Strictly restricts JS bridge injection and message handling to trusted app origins.
@objc(ArcheryIosNativeAuthManager)
final class ArcheryIosNativeAuthManager: NSObject,
    WKScriptMessageHandler,
    ASWebAuthenticationPresentationContextProviding,
    ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {

    static let shared = ArcheryIosNativeAuthManager()

    private let handlerName = "ArcheryIosAuth"
    private let googleWebClientId = "757910399585-q71dprgcodk5s2t67965gdfusr1lv441.apps.googleusercontent.com"
    private let firebaseAuthHandlerHost = "archery101010-c0bb4.firebaseapp.com"
    private let firebaseAuthHandlerPath = "/__/auth/handler"
    private let firebaseAuthHandlerUri = "https://archery101010-c0bb4.firebaseapp.com/__/auth/handler"
    private let customCallbackScheme = "com.archery101010.app"
    private let alternateCallbackScheme = "archery101010"
    private let appleProfileCachePrefix = "archery_apple_profile_"

    private weak var webView: WKWebView?
    private var activeWebAuthSession: ASWebAuthenticationSession?
    private var activeGoogleNonce: String = ""
    private var activeAppleRawNonce: String = ""
    private var pendingGoogleIdToken: String = ""
    private var pendingAppleAuthJson: String = ""

    private override init() {
        super.init()
    }

    // MARK: - Attachment & Trusted Origin JS Shim

    func attach(to webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: handlerName)
        ucc.add(self, name: handlerName)

        let shellVersion = escapeJs(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "2.159")
        let initialGoogleToken = escapeJs(pendingGoogleIdToken)
        let initialAppleJson = escapeJs(pendingAppleAuthJson)

        let shimJs = """
        (function() {
          var o = String((window.location && window.location.origin) || '').toLowerCase();
          if (o !== 'capacitor://localhost' &&
              o !== 'ionic://localhost' &&
              o !== 'https://archery101010-c0bb4.web.app' &&
              o !== 'https://archery101010-c0bb4.firebaseapp.com') {
            return;
          }
          if (window.ArcheryNativeAuth) return;
          window.__archeryPendingGoogleIdToken = '\(initialGoogleToken)';
          window.__archeryPendingAppleAuthJson = '\(initialAppleJson)';
          window.ArcheryNativeAuth = {
            isNativeIos: true,
            getShellVersion: function() {
              return '\(shellVersion)';
            },
            startGoogleSignIn: function(optionsJson) {
              return new Promise(function(resolve) {
                window.__archeryIosGoogleResolve = resolve;
                window.webkit.messageHandlers.ArcheryIosAuth.postMessage({
                  action: 'startGoogleSignIn',
                  optionsJson: typeof optionsJson === 'string' ? optionsJson : ''
                });
              });
            },
            consumePendingGoogleIdToken: function() {
              var tok = window.__archeryPendingGoogleIdToken || '';
              window.__archeryPendingGoogleIdToken = '';
              if (tok) {
                window.webkit.messageHandlers.ArcheryIosAuth.postMessage({ action: 'clearPendingGoogleIdToken' });
              }
              return tok;
            },
            startAppleSignIn: function(rawNonce) {
              return new Promise(function(resolve) {
                window.__archeryIosAppleResolve = resolve;
                window.webkit.messageHandlers.ArcheryIosAuth.postMessage({
                  action: 'startAppleSignIn',
                  rawNonce: typeof rawNonce === 'string' ? rawNonce : ''
                });
              });
            },
            consumePendingAppleAuthJson: function() {
              var raw = window.__archeryPendingAppleAuthJson || '';
              window.__archeryPendingAppleAuthJson = '';
              if (raw) {
                window.webkit.messageHandlers.ArcheryIosAuth.postMessage({ action: 'clearPendingAppleAuth' });
              }
              return raw;
            },
            openOAuthSession: function(url, callbackScheme) {
              return new Promise(function(resolve) {
                window.__archeryIosOAuthResolve = resolve;
                window.webkit.messageHandlers.ArcheryIosAuth.postMessage({
                  action: 'openOAuthSession',
                  url: String(url || ''),
                  callbackScheme: String(callbackScheme || 'com.archery101010.app')
                });
              });
            }
          };
        })();
        """

        ucc.addUserScript(WKUserScript(source: shimJs, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if ArcheryWatchSessionManager.isTrustedWebViewURL(webView.url) {
            webView.evaluateJavaScript(shimJs, completionHandler: nil)
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              ArcheryWatchSessionManager.isTrustedOrigin(securityOrigin: message.frameInfo.securityOrigin),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }

        switch action {
        case "startGoogleSignIn":
            let optionsJson = (body["optionsJson"] as? String) ?? ""
            startGoogleSignInFlow(optionsJson: optionsJson)
        case "clearPendingGoogleIdToken":
            pendingGoogleIdToken = ""
        case "startAppleSignIn":
            let rawNonce = (body["rawNonce"] as? String) ?? ""
            startAppleSignInFlow(explicitRawNonce: rawNonce)
        case "clearPendingAppleAuth":
            pendingAppleAuthJson = ""
        case "openOAuthSession":
            let urlStr = (body["url"] as? String) ?? ""
            let scheme = (body["callbackScheme"] as? String) ?? customCallbackScheme
            startGenericOAuthSession(urlStr: urlStr, callbackScheme: scheme)
        default:
            break
        }
    }

    // MARK: - Deep Link / Universal Link Continuation Fallback

    @discardableResult
    func handleIncomingOpenURL(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()
        let path = url.path

        let isCustomAuthCallback = (scheme == customCallbackScheme.lowercased() || scheme == alternateCallbackScheme)
        let isUniversalAuthCallback = (scheme == "https" &&
            (host == firebaseAuthHandlerHost || host == "archery101010-c0bb4.web.app") &&
            path.hasPrefix("/__/auth"))

        guard isCustomAuthCallback || isUniversalAuthCallback else {
            return false
        }

        if (url.fragment ?? "").contains("id_token=") || (url.query ?? "").contains("id_token=") ||
           (url.fragment ?? "").contains("error=") || (url.query ?? "").contains("error=") {
            activeWebAuthSession?.cancel()
            activeWebAuthSession = nil
            processGoogleCallbackURL(url)
            return true
        }
        return false
    }

    // MARK: - Google OAuth 2.0 via ASWebAuthenticationSession

    private func startGoogleSignInFlow(optionsJson: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.activeWebAuthSession?.cancel()
            self.activeWebAuthSession = nil

            var hl = (Locale.current.languageCode ?? "es").lowercased().hasPrefix("es") ? "es" : "en"
            var customNonce = ""
            if !optionsJson.isEmpty,
               let optData = optionsJson.data(using: .utf8),
               let optDict = try? JSONSerialization.jsonObject(with: optData) as? [String: Any] {
                if let lang = optDict["hl"] as? String, !lang.isEmpty {
                    hl = lang
                }
                if let n = optDict["nonce"] as? String, !n.isEmpty {
                    customNonce = n
                }
            }

            let nonce = customNonce.isEmpty ? self.generateSecureHexNonce(byteCount: 16) : customNonce
            self.activeGoogleNonce = nonce

            var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")
            comps?.queryItems = [
                URLQueryItem(name: "client_id", value: self.googleWebClientId),
                URLQueryItem(name: "redirect_uri", value: self.firebaseAuthHandlerUri),
                URLQueryItem(name: "response_type", value: "id_token"),
                URLQueryItem(name: "scope", value: "openid email profile"),
                URLQueryItem(name: "nonce", value: nonce),
                URLQueryItem(name: "hl", value: hl),
                URLQueryItem(name: "prompt", value: "select_account")
            ]

            guard let authURL = comps?.url else {
                self.emitGoogleSignInError(statusCode: -1, message: "Invalid OAuth URL")
                return
            }

            let completion: ASWebAuthenticationSession.CompletionHandler = { [weak self] callbackURL, error in
                guard let self = self else { return }
                self.activeWebAuthSession = nil

                if let callbackURL = callbackURL {
                    self.processGoogleCallbackURL(callbackURL)
                    return
                }

                if let nsErr = error as NSError?,
                   nsErr.domain == ASWebAuthenticationSessionErrorDomain,
                   nsErr.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                    self.emitGoogleSignInError(statusCode: 12501, message: "canceled")
                    return
                }

                self.emitGoogleSignInError(
                    statusCode: -1,
                    message: error?.localizedDescription ?? "OAuth authentication failed"
                )
            }

            let session: ASWebAuthenticationSession
            if #available(iOS 17.4, *) {
                session = ASWebAuthenticationSession(
                    url: authURL,
                    callback: .https(host: self.firebaseAuthHandlerHost, path: self.firebaseAuthHandlerPath),
                    completionHandler: completion
                )
            } else {
                session = ASWebAuthenticationSession(
                    url: authURL,
                    callbackURLScheme: self.customCallbackScheme,
                    completionHandler: completion
                )
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.activeWebAuthSession = session
            if !session.start() {
                self.activeWebAuthSession = nil
                self.emitGoogleSignInError(statusCode: -1, message: "Could not start ASWebAuthenticationSession")
            }
        }
    }

    private func processGoogleCallbackURL(_ url: URL) {
        let params = extractUrlAndFragmentParams(url)
        if let err = params["error"], !err.isEmpty {
            if err == "access_denied" {
                emitGoogleSignInError(statusCode: 12501, message: "canceled")
            } else {
                emitGoogleSignInError(statusCode: -1, message: err)
            }
            return
        }

        guard let idToken = params["id_token"], !idToken.isEmpty else {
            emitGoogleSignInError(statusCode: -1, message: "Missing id_token in callback")
            return
        }

        guard let claims = decodeJwtPayload(idToken) else {
            emitGoogleSignInError(statusCode: -1, message: "Malformed id_token")
            return
        }

        let aud = (claims["aud"] as? String) ?? ""
        let tokenNonce = (claims["nonce"] as? String) ?? ""
        guard aud == googleWebClientId,
              !activeGoogleNonce.isEmpty,
              tokenNonce == activeGoogleNonce else {
            activeGoogleNonce = ""
            emitGoogleSignInError(statusCode: -1, message: "Nonce or audience mismatch")
            return
        }
        activeGoogleNonce = ""

        let email = (claims["email"] as? String) ?? ""
        let displayName = (claims["name"] as? String) ?? ""
        let googleId = (claims["sub"] as? String) ?? ""

        pendingGoogleIdToken = idToken
        let payload: [String: Any] = [
            "success": true,
            "idToken": idToken,
            "email": email,
            "displayName": displayName,
            "googleId": googleId
        ]
        emitGoogleSignInPayload(payload)
    }

    private func startGenericOAuthSession(urlStr: String, callbackScheme: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let targetURL = URL(string: urlStr) else {
                self?.emitGenericOAuthResult(["success": false, "error": "Invalid URL"])
                return
            }
            self.activeWebAuthSession?.cancel()
            let cleanScheme = callbackScheme.isEmpty ? self.customCallbackScheme : callbackScheme
            let session = ASWebAuthenticationSession(url: targetURL, callbackURLScheme: cleanScheme) { [weak self] callbackURL, error in
                self?.activeWebAuthSession = nil
                if let callbackURL = callbackURL {
                    self?.emitGenericOAuthResult([
                        "success": true,
                        "callbackUrl": callbackURL.absoluteString
                    ])
                } else {
                    let isCanceled = (error as NSError?)?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
                    self?.emitGenericOAuthResult([
                        "success": false,
                        "canceled": isCanceled,
                        "error": error?.localizedDescription ?? "OAuth session ended"
                    ])
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.activeWebAuthSession = session
            _ = session.start()
        }
    }

    // MARK: - Native Sign in with Apple (Guideline 4.8)

    private func startAppleSignInFlow(explicitRawNonce: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let rawNonce = explicitRawNonce.isEmpty ? self.generateSecureHexNonce(byteCount: 24) : explicitRawNonce
            self.activeAppleRawNonce = rawNonce

            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = self.sha256Hex(rawNonce)

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8),
              !idToken.isEmpty else {
            emitAppleSignInPayload([
                "success": false,
                "statusCode": -1,
                "error": "Missing Apple identityToken"
            ])
            return
        }

        let authCode: String
        if let codeData = credential.authorizationCode, let codeStr = String(data: codeData, encoding: .utf8) {
            authCode = codeStr
        } else {
            authCode = ""
        }

        let userHash = sha256Hex(credential.user)
        let cacheEmailKey = "\(appleProfileCachePrefix)email_\(userHash)"
        let cacheNameKey = "\(appleProfileCachePrefix)name_\(userHash)"

        let jwtClaims = decodeJwtPayload(idToken)
        let jwtEmail = (jwtClaims?["email"] as? String) ?? ""
        var resolvedEmail = (credential.email ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if resolvedEmail.isEmpty {
            resolvedEmail = jwtEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if !resolvedEmail.isEmpty {
            UserDefaults.standard.set(resolvedEmail, forKey: cacheEmailKey)
        } else {
            resolvedEmail = UserDefaults.standard.string(forKey: cacheEmailKey) ?? ""
        }

        var nameParts: [String] = []
        if let given = credential.fullName?.givenName?.trimmingCharacters(in: .whitespacesAndNewlines), !given.isEmpty {
            nameParts.append(given)
        }
        if let family = credential.fullName?.familyName?.trimmingCharacters(in: .whitespacesAndNewlines), !family.isEmpty {
            nameParts.append(family)
        }
        var resolvedName = nameParts.joined(separator: " ")
        if !resolvedName.isEmpty {
            UserDefaults.standard.set(resolvedName, forKey: cacheNameKey)
        } else {
            resolvedName = UserDefaults.standard.string(forKey: cacheNameKey) ?? ""
        }

        let rawNonce = activeAppleRawNonce
        activeAppleRawNonce = ""

        let payload: [String: Any] = [
            "success": true,
            "idToken": idToken,
            "rawNonce": rawNonce,
            "authorizationCode": authCode,
            "email": resolvedEmail,
            "displayName": resolvedName,
            "fullName": resolvedName,
            "appleUserId": credential.user
        ]
        emitAppleSignInPayload(payload)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        activeAppleRawNonce = ""
        let nsErr = error as NSError
        let isCanceled = (nsErr.domain == ASAuthorizationError.errorDomain && nsErr.code == ASAuthorizationError.canceled.rawValue)
        emitAppleSignInPayload([
            "success": false,
            "statusCode": isCanceled ? 12501 : -1,
            "error": isCanceled ? "canceled" : error.localizedDescription
        ])
    }

    // MARK: - Presentation Anchor

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return resolveActiveWindow()
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return resolveActiveWindow()
    }

    private func resolveActiveWindow() -> ASPresentationAnchor {
        if let wvWindow = webView?.window {
            return wvWindow
        }
        for scene in UIApplication.shared.connectedScenes {
            if let windowScene = scene as? UIWindowScene {
                if let keyWin = windowScene.windows.first(where: { $0.isKeyWindow }) {
                    return keyWin
                }
                if let firstWin = windowScene.windows.first {
                    return firstWin
                }
            }
        }
        return ASPresentationAnchor()
    }

    // MARK: - WebView JS Dispatchers

    private func emitGoogleSignInError(statusCode: Int, message: String) {
        emitGoogleSignInPayload([
            "success": false,
            "statusCode": statusCode,
            "error": message
        ])
    }

    private func emitGoogleSignInPayload(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let jsonStr = String(data: data, encoding: .utf8) else { return }
        let escapedToken = escapeJs(pendingGoogleIdToken)
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.webView,
                  ArcheryWatchSessionManager.isTrustedWebViewURL(webView.url) else { return }
            let js = """
            (function() {
              window.__archeryPendingGoogleIdToken = '\(escapedToken)';
              var res = \(jsonStr);
              if (typeof window.__onNativeGoogleSignIn === 'function') {
                window.__onNativeGoogleSignIn(res);
              }
              if (typeof window.__archeryIosGoogleResolve === 'function') {
                var r = window.__archeryIosGoogleResolve;
                window.__archeryIosGoogleResolve = null;
                r(res);
              }
            })();
            """
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func emitAppleSignInPayload(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let jsonStr = String(data: data, encoding: .utf8) else { return }
        if (payload["success"] as? Bool) == true {
            pendingAppleAuthJson = jsonStr
        }
        let escapedPending = escapeJs(pendingAppleAuthJson)
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.webView,
                  ArcheryWatchSessionManager.isTrustedWebViewURL(webView.url) else { return }
            let js = """
            (function() {
              window.__archeryPendingAppleAuthJson = '\(escapedPending)';
              var res = \(jsonStr);
              if (typeof window.__onNativeAppleSignIn === 'function') {
                window.__onNativeAppleSignIn(res);
              }
              if (typeof window.__archeryIosAppleResolve === 'function') {
                var r = window.__archeryIosAppleResolve;
                window.__archeryIosAppleResolve = null;
                r(res);
              }
            })();
            """
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func emitGenericOAuthResult(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let jsonStr = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let webView = self.webView,
                  ArcheryWatchSessionManager.isTrustedWebViewURL(webView.url) else { return }
            let js = """
            (function() {
              var res = \(jsonStr);
              if (typeof window.__onNativeOAuthCallback === 'function') {
                window.__onNativeOAuthCallback(res);
              }
              if (typeof window.__archeryIosOAuthResolve === 'function') {
                var r = window.__archeryIosOAuthResolve;
                window.__archeryIosOAuthResolve = null;
                r(res);
              }
            })();
            """
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: - Crypto & JWT Utilities

    private func generateSecureHexNonce(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: max(16, byteCount))
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            return UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func sha256Hex(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func extractUrlAndFragmentParams(_ url: URL) -> [String: String] {
        var out: [String: String] = [:]
        if let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let items = comps.queryItems {
            for item in items {
                if let val = item.value {
                    out[item.name] = val
                }
            }
        }
        if let fragment = url.fragment, !fragment.isEmpty {
            var fragComps = URLComponents()
            fragComps.query = fragment
            if let items = fragComps.queryItems {
                for item in items {
                    if let val = item.value {
                        out[item.name] = val
                    }
                }
            }
        }
        return out
    }

    private func decodeJwtPayload(_ jwt: String) -> [String: Any]? {
        let segments = jwt.split(separator: ".")
        guard segments.count >= 2 else { return nil }
        var base64 = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let rem = base64.count % 4
        if rem > 0 {
            base64 += String(repeating: "=", count: 4 - rem)
        }
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return json
    }

    private func escapeJs(_ raw: String) -> String {
        return raw
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}
