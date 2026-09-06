package com.olatoyefamily.familyos

import com.olatoyefamily.familyos.BuildConfig
import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.FrameLayout

/**
 * Family OS TV — Main Activity
 *
 * Minimal Android TV shell for the Family OS web client.
 * Owns: fullscreen WebView, TV launcher presence, D-pad forwarding,
 *       WebView storage persistence (localStorage/cookies survive process restarts).
 * Does NOT own: Family OS product logic, Surface session, pairing, Guardian.
 * All product logic lives in https://olatoyefamily.com/hub/
 *
 * Phase 0B: prove the container and Surface identity lifecycle.
 * No custom JS bridge — WebView localStorage is the session store.
 * No exit confirmation modal — normal platform Back behaviour at root.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    // Canonical Family OS TV URL — single constant, never constructed at runtime
    private val HUB_URL = "https://olatoyefamily.com/hub/"

    // Approved origins — top-level WebView navigation only.
    // Supabase HTTPS/WSS requests are JavaScript network calls, not WebView navigation.
    // They work regardless of this list; this list only controls URL bar navigation.
    private val APPROVED_ORIGINS = setOf(
        "olatoyefamily.com",
    )

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Fullscreen — no status bar, no navigation bar
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )

            settings.apply {
                // Required for Family OS web client
                javaScriptEnabled = true          // Item 3: JS enabled
                domStorageEnabled = true          // Item 3: localStorage — Surface session persistence
                databaseEnabled = false           // WebSQL is obsolete — DOM/localStorage sufficient
                allowFileAccess = false           // Item 3: no local file access
                allowContentAccess = false        // Item 3: no content:// URIs

                // WebSocket / Realtime — no special flag needed; WebView supports WSS natively
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)

                // No mixed content — HTTPS only (Supabase + olatoyefamily.com are both HTTPS)
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

                // Cache — use default (network when available, cache as fallback)
                cacheMode = WebSettings.LOAD_DEFAULT

                // TV display — no zoom
                builtInZoomControls = false
                displayZoomControls = false
                useWideViewPort = true
                loadWithOverviewMode = true

                // WebView debugging: enabled in debug builds only (set in FamilyOSChromeClient)
                // DO NOT enable in release — exposes internal state
            }

            // Cookies — required for Supabase Auth session
            CookieManager.getInstance().setAcceptCookie(true)

            webViewClient = FamilyOSWebViewClient(APPROVED_ORIGINS)
            webChromeClient = FamilyOSChromeClient()

            // Hardware acceleration for smooth rendering
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
        }

        // Restrict to first-party cookies only
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        setContentView(webView)

        // Restore WebView state if available (preserves in-page navigation history)
        // NOTE: savedInstanceState does NOT restore localStorage — that persists
        // independently via WebView's own storage (survives process death).
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(HUB_URL)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /**
     * D-pad and remote key handling.
     *
     * Back behaviour (per approved Phase 0B spec):
     *   - deeper content/view within web app → web app handles via history.back()
     *   - at web app root → normal Android TV platform behaviour (exits app)
     *   - NO exit confirmation modal — add only if physical testing shows accidental exits
     *
     * D-pad: forwarded to WebView for focus/scroll navigation.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_BACK -> {
                // Let WebView handle back if it has history, otherwise platform default
                if (webView.canGoBack()) {
                    webView.goBack()
                    return true
                }
                // At root: normal platform behaviour — exits app via super
                return super.onKeyDown(keyCode, event)
            }

            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER -> {
                webView.dispatchKeyEvent(event)
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }
}

/**
 * WebViewClient — navigation policy.
 *
 * Item 3: navigation restricted to approved Family OS origins.
 * External URLs (e.g. Google OAuth callback) are permitted via Supabase subdomain.
 * Arbitrary external navigation is blocked silently.
 */
class FamilyOSWebViewClient(
    private val approvedOrigins: Set<String>
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val host = request.url.host ?: return true // block malformed URLs
        val approved = approvedOrigins.any { o -> host == o || host.endsWith(".$o") }
        if (!approved) {
            android.util.Log.w("FamilyOS", "Blocked navigation: ${request.url.host}")
        }
        return !approved // true = block, false = allow
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        // Inject provisioning grant as JS global after each page load
        // Server-side consumption makes the permanently-extractable APK value useless after first use
        val grant = BuildConfig.SURFACE_PROVISIONING_GRANT
        if (grant.isNotEmpty()) {
            val js = "window.SURFACE_PROVISIONING_GRANT='" + grant + "';"
            view?.evaluateJavascript(js, null)
        }
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError
    ) {
        if (request.isForMainFrame) {
            android.util.Log.e("FamilyOS", "Load error: ${error.description} — ${request.url}")
            // Inline error — never a blank screen
            view.loadData(
                """<!DOCTYPE html><html><body style="background:#080d08;color:rgba(255,255,255,0.4);
                   font-family:sans-serif;display:flex;align-items:center;justify-content:center;
                   height:100vh;margin:0;text-align:center;">
                   <div><p style="font-size:18px">Unable to connect</p>
                   <p style="font-size:13px;margin-top:12px">Check your network connection</p>
                   </div></body></html>""",
                "text/html", "UTF-8"
            )
        }
    }
}

/**
 * ChromeClient
 *
 * Item 3: WebView debugging enabled in debug builds only.
 * Console messages forwarded to logcat in all builds (no sensitive data logged by web client).
 */
class FamilyOSChromeClient : WebChromeClient() {

    init {
        // Enable Chrome DevTools remote debugging in debug builds only
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        }
    }

    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        android.util.Log.d(
            "FamilyOS-Web",
            "[${message.messageLevel()}] ${message.message()} " +
            "(${message.sourceId()}:${message.lineNumber()})"
        )
        return true
    }
}
