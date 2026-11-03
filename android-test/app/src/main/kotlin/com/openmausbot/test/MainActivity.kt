package com.openmausbot.test

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import java.io.File
import android.util.Log
import android.view.ViewGroup
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class MainActivity : Activity() {

    private var webView: WebView? = null
    private var chooserCallback: ValueCallback<Array<Uri>>? = null
    private var scope: CoroutineScope? = null
    private var statusJob: Job? = null

    private lateinit var bootScreen: LinearLayout
    private lateinit var bootStatus: TextView
    private lateinit var bootLog: TextView
    private lateinit var retryButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        bootScreen = findViewById(R.id.boot_screen)
        bootStatus = findViewById(R.id.boot_status_text)
        bootLog = findViewById(R.id.boot_log_text)
        retryButton = findViewById(R.id.boot_retry_button)
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        styleSystemBars()
        applyInsets()
        retryButton.setOnClickListener {
            bootLog.visibility = View.GONE
            startHostService()
        }
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        statusJob = scope?.launch {
            NodeState.status.collect { status -> render(status) }
        }
        startHostService()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        startHostService()
    }

    private fun startHostService() {
        val service = Intent(this, NodeHostService::class.java)
        startForegroundService(service)
    }

    private fun render(status: NodeState.Status) = when (status.phase) {
        NodeState.Phase.Ready -> if (status.paired) attachWebView() else showBoot(describe(status), status.logTail)
        NodeState.Phase.Failed,
        NodeState.Phase.BundleMissing,
        NodeState.Phase.RuntimeMissing,
        -> showBoot(describe(status), status.logTail, failure = true)
        else -> showBoot(describe(status), status.logTail)
    }

    private fun describe(status: NodeState.Status): String {
        val detail = status.detail.takeIf { it.isNotEmpty() }
        return when (status.phase) {
            NodeState.Phase.Idle -> getString(R.string.boot_idle)
            NodeState.Phase.Extracting -> getString(R.string.status_extracting)
            NodeState.Phase.BundleMissing -> getString(R.string.status_bundle_missing)
            NodeState.Phase.RuntimeMissing -> getString(R.string.status_runtime_missing)
            NodeState.Phase.Starting -> getString(R.string.status_starting) + detail?.let { " — $it" }.orEmpty()
            NodeState.Phase.Running -> getString(R.string.status_running)
            NodeState.Phase.Ready -> if (status.paired) getString(R.string.status_ready) else getString(R.string.status_pairing)
            NodeState.Phase.Failed -> getString(R.string.status_failed) + detail?.let { "\n$it" }.orEmpty()
            NodeState.Phase.Stopped -> getString(R.string.status_stopped) + detail?.let { " — $it" }.orEmpty()
        }
    }

    private fun showBoot(text: String, logTail: String = "", failure: Boolean = false) {
        if (webView != null) {
            if (failure) detachWebView() else return
        }
        bootScreen.visibility = View.VISIBLE
        bootStatus.text = text
        retryButton.visibility = if (failure) View.VISIBLE else View.GONE
        if (logTail.isNotBlank() && failure) {
            bootLog.text = logTail
            bootLog.visibility = View.VISIBLE
        } else {
            bootLog.visibility = View.GONE
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun attachWebView() {
        if (webView != null) return
        if (Build.VERSION.SDK_INT >= 19) WebView.setWebContentsDebuggingEnabled(true)
        val root = findViewById<ViewGroup>(R.id.root)
        val view = WebView(this)
        view.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        view.setBackgroundColor(WINDOW_COLOR)
        view.isVerticalScrollBarEnabled = false
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(view, false)
        // The phone's bundle is replaced on every VERSION change, but the
        // WebView's HTTP cache would otherwise keep serving the previous JS.
        view.clearCache(true)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // The phone's bundle is replaced on every VERSION change; never serve
            // a stale JS chunk from the WebView's cache over it.
            cacheMode = WebSettings.LOAD_NO_CACHE
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = false
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            userAgentString = "$userAgentString SpokyBot/1.0"
        }
        // The web UI's notifications ride the web Notification API, which a plain
        // WebView never grants; the bridge stands in for it.
        view.addJavascriptInterface(
            object {
                @android.webkit.JavascriptInterface
                fun capabilitiesJson(): String = CAPABILITIES_JSON

                @android.webkit.JavascriptInterface
                fun buildVersion(): String = runCatching {
                    File(filesDir, "omb-installed/VERSION").readText().trim()
                }.getOrDefault("unknown")

                @android.webkit.JavascriptInterface
                fun notify(title: String, body: String) {
                    postBotNotification(title, body)
                }

                @android.webkit.JavascriptInterface
                fun saveBackup(url: String, filename: String) {
                    if (url.isBlank() || filename.isBlank()) return
                    val absolute = if (url.startsWith("http")) url else "http://127.0.0.1:8799$url"
                    val parsed = runCatching { java.net.URL(absolute) }.getOrNull() ?: return
                    if (parsed.protocol != "http" || parsed.host != "127.0.0.1" || parsed.port != 8799 ||
                        !parsed.path.startsWith("/api/workspace-backup/download/")) return
                    pendingSave = absolute to filename
                    runOnUiThread {
                        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "application/json"
                            putExtra(Intent.EXTRA_TITLE, filename)
                        }
                        runCatching { startActivityForResult(intent, REQUEST_SAVE) }
                    }
                }
            },
            "ombAndroidCaps",
        )
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "http" && (url.host == "127.0.0.1" || url.host == "localhost")) return false
                // The UI's own docs/help links leave the app's loopback origin:
                // open them with the system's browser, never inside the paired WebView.
                if (url.scheme == "http" || url.scheme == "https") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(
                    "(window.ombAndroidCaps ? 'bridge:' + ombAndroidCaps.capabilitiesJson().slice(0, 60) + ' notify:' + typeof ombAndroidCaps.notify : 'bridge:MISSING')",
                ) { result -> android.util.Log.d("OMBTest", "caps $result") }
            }
        }
        view.setDownloadListener { url, _, _, _, _ ->
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                chooserCallback?.onReceiveValue(null)
                chooserCallback = callback
                val intent = params.createIntent().addCategory(Intent.CATEGORY_OPENABLE)
                return try {
                    startActivityForResult(intent, REQUEST_FILE)
                    true
                } catch (e: android.content.ActivityNotFoundException) {
                    chooserCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }
        root.addView(view)
        bootScreen.visibility = View.GONE
        webView = view
        view.loadUrl(NodeHostService.BASE_URL + "/")
    }

    private fun detachWebView() {
        val view = webView ?: return
        webView = null
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
        Log.w(TAG, "WebView detached for failure recovery")
    }

    @Volatile
    private var pendingSave: Pair<String, String>? = null

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_FILE) {
            val callback = chooserCallback
            chooserCallback = null
            callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            return
        }
        if (requestCode == REQUEST_SAVE) {
            val uri = data?.data
            val pending = pendingSave
            pendingSave = null
            if (resultCode == Activity.RESULT_OK && uri != null && pending != null) {
                Thread { downloadAndWrite(pending.first, uri) }.start()
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun downloadAndWrite(url: String, uri: android.net.Uri) {
        runCatching {
            val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            connection.connectTimeout = 15_000
            connection.readTimeout = 120_000
            connection.useCaches = false
            CookieManager.getInstance().getCookie(url)?.takeIf { it.isNotBlank() }?.let {
                connection.setRequestProperty("Cookie", it)
            }
            try {
                val status = connection.responseCode
                if (status !in 200..299) {
                    val detail = connection.errorStream?.bufferedReader()?.use { it.readText().take(500) }.orEmpty()
                    throw java.io.IOException("server returned HTTP $status${if (detail.isBlank()) "" else ": $detail"}")
                }
                connection.inputStream.use { input ->
                    contentResolver.openOutputStream(uri, "w")?.use { output ->
                        input.copyTo(output)
                    } ?: throw java.io.IOException("could not open the chosen file")
                }
            } finally {
                connection.disconnect()
            }
            runOnUiThread { android.widget.Toast.makeText(this, "Backup saved.", android.widget.Toast.LENGTH_SHORT).show() }
        }.onFailure { cause ->
            runOnUiThread {
                android.widget.Toast.makeText(this, "Backup save failed: ${cause.message}", android.widget.Toast.LENGTH_LONG).show()
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val view = webView
        if (view != null && view.canGoBack()) {
            view.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        startHostService()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        statusJob?.cancel()
        scope?.cancel()
        val view = webView
        webView = null
        if (view != null) {
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        super.onDestroy()
    }

    private fun styleSystemBars() {
        window.statusBarColor = WINDOW_COLOR
        window.navigationBarColor = WINDOW_COLOR
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)
        }
        window.setDecorFitsSystemWindows(false)
    }

    private fun applyInsets() {
        val root = findViewById<View>(R.id.root)
        root.setOnApplyWindowInsetsListener { target, insets ->
            val padding = insets.getInsets(
                WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars() or
                    WindowInsets.Type.displayCutout() or WindowInsets.Type.ime(),
            )
            target.setPadding(padding.left, padding.top, padding.right, padding.bottom)
            insets
        }
    }

    /** System notification for a bot message the person is not looking at,
     * posted by the web UI through the ombAndroidCaps WebView bridge. */
    private fun postBotNotification(title: String, body: String) {
        runCatching {
            val manager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            manager.createNotificationChannel(
                android.app.NotificationChannel(
                    MESSAGES_CHANNEL,
                    "Bot messages",
                    android.app.NotificationManager.IMPORTANCE_DEFAULT,
                ),
            )
            val intent = android.app.PendingIntent.getActivity(
                this, 0, intent, android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = android.app.Notification.Builder(this, MESSAGES_CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(android.app.Notification.BigTextStyle().bigText(body))
                .setContentIntent(intent)
                .setAutoCancel(true)
                .build()
            manager.notify(body.hashCode(), notification)
        }
    }

    companion object {
        private const val TAG = "OmbLocalTest"
        private const val REQUEST_FILE = 7
        private const val REQUEST_SAVE = 8
        private const val MESSAGES_CHANNEL = "omb-messages"
        private val WINDOW_COLOR = 0xFF070707.toInt()

        /** What src/lib/desktop.ts reads through the `ombAndroidCaps` WebView bridge:
         * the phone shell reports the local computer (its own Linux environment) as
         * ready, everything desktop-only (screen preview, dictation) as absent. */
        private const val CAPABILITIES_JSON =
            "{\"host\":{\"platform\":\"other\",\"label\":\"Tablet\",\"session\":\"headless\",\"packaged\":true}," +
                "\"windowChrome\":\"native\"," +
                "\"screenPreview\":{\"available\":false,\"interaction\":\"none\",\"reasonCode\":\"desktop-app-required\"}," +
                "\"dictation\":{\"available\":false,\"engine\":\"none\",\"onDevice\":false,\"reasonCode\":\"desktop-app-required\"}," +
                "\"localComputer\":{\"available\":true,\"support\":\"supported\",\"enabled\":true,\"status\":\"ready\"}}"
    }
}