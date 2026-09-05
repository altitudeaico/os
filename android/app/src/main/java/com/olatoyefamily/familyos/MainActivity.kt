package com.olatoyefamily.familyos

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
 *       WebView storage persistence (localStorage/sessionStorage/cookies).
 * Does NOT own: Family OS product logic, Surface session, pairing, Guardian.
 * All product logic lives in https://olatoyefamily.com/hub/
 *
 * Phase 0B: prove the container and Surface identity lifecycle.
 * No custom JS bridge unless WebView persistence proves insufficient.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    // Canonical Family OS TV URL — single constant, never constructed at runtime
    private val HUB_URL = "https://olatoyefamily.com/hub/"

    // Approved origins — WebView navigation restricted to these
    private val APPROVED_ORIGINS = setOf(
        "olatoyefamily.com",
        "fypwabbhxnnwcpfjwrda.supabase.co",  // Supabase API + Realtime
    )

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Fullscreen — no status bar, no navigation bar
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
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
                javaScriptEnabled = true
                domStorageEnabled = true          // localStorage — Surface session persistence
                databaseEnabled = true
                allowFileAccess = false           // no local file access
                allowContentAccess = false

                // WebSocket / Realtime support
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)

                // Performance
                cacheMode = WebSettings.LOAD_DEFAULT
                mediaPlaybackRequiresUserGesture = false

                // TV display — no zoom controls
                builtInZoomControls = false
                displayZoomControls = false
                useWideViewPort = true
                loadWithOverviewMode = true
            }

            // Accept cookies (needed for Supabase Auth)
            CookieManager.getInstance().apply {
                setAcceptCookie(true)
                setAcceptThirdPartyCookies(this@apply, true)
            }

            webViewClient = FamilyOSWebViewClient(APPROVED_ORIGINS)
            webChromeClient = FamilyOSChromeClient()

            // Hardware acceleration for smooth TV experience
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
        }

        setContentView(webView)

        // Restore WebView state across process death (preserves localStorage)
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
     * TV remotes send DPAD events — forward them to WebView for focus navigation.
     * Back key at root shows exit confirmation rather than exiting immediately.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Back key: confirm before exit
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                showExitConfirmation()
            }
            return true
        }

        // D-pad: forward to WebView for focus navigation
        if (keyCode in setOf(
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER
        )) {
            webView.dispatchKeyEvent(event)
            return true
        }

        return super.onKeyDown(keyCode, event)
    }

    private fun showExitConfirmation() {
        android.app.AlertDialog.Builder(this)
            .setMessage("Exit Family OS?")
            .setPositiveButton("Exit") { _, _ -> finish() }
            .setNegativeButton("Stay") { d, _ -> d.dismiss() }
            .show()
    }
}

/**
 * WebViewClient — navigation policy.
 * Restricts navigation to approved Family OS origins only.
 * Supabase auth callbacks are permitted; arbitrary external navigation is blocked.
 */
class FamilyOSWebViewClient(
    private val approvedOrigins: Set<String>
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val host = request.url.host ?: return true // block if no host
        val isApproved = approvedOrigins.any { origin -> host == origin || host.endsWith(".$origin") }

        return if (isApproved) {
            false // allow WebView to load it
        } else {
            // Block navigation outside approved origins
            // Log for diagnostics but do not expose to user
            android.util.Log.w("FamilyOS", "Blocked navigation to: ${request.url.host}")
            true
        }
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError
    ) {
        // Only handle errors for the main frame (not sub-resources)
        if (request.isForMainFrame) {
            android.util.Log.e("FamilyOS", "WebView error: ${error.description} — ${request.url}")
            // Load an inline error page rather than showing a blank screen
            view.loadData(
                """<!DOCTYPE html><html><body style="background:#000;color:rgba(255,255,255,0.4);
                   font-family:sans-serif;display:flex;align-items:center;justify-content:center;
                   height:100vh;margin:0;text-align:center;">
                   <div><p style="font-size:18px">Unable to connect</p>
                   <p style="font-size:13px;margin-top:12px">Check your network connection</p></div>
                   </body></html>""",
                "text/html", "UTF-8"
            )
        }
    }
}

/**
 * ChromeClient — minimal TV requirements.
 * Handles console messages for diagnostics.
 */
class FamilyOSChromeClient : WebChromeClient() {
    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        android.util.Log.d(
            "FamilyOS-Web",
            "[${message.messageLevel()}] ${message.message()} (${message.sourceId()}:${message.lineNumber()})"
        )
        return true
    }
}
