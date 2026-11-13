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
import android.webkit.PermissionRequest
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
        if (intent?.action == Intent.ACTION_VIEW) pendingDeepLink = intent.dataString
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
        setIntent(intent)
        startHostService()
        intent.dataString?.let { dispatchDeepLink(it) }
    }

    private var pendingDeepLink: String? = null
    private var pageReady = false

    /** Turns an openmausbot:// link into the DOM event the page already listens for
     * the Electron shell's equivalents of (chat links, Settings sections, installs).
     * The window queue is the page's own contract for links that arrive before its
     * listeners mount (src/lib/deep-link-events.ts). */
    private fun dispatchDeepLink(url: String) {
        val view = webView
        if (view == null || !pageReady) {
            pendingDeepLink = url
            return
        }
        val host = url.substringAfter("://", "").substringBefore("/").substringBefore("?")
        val delivery = when (host) {
            "thread", "bot" -> "omb:chat-link" to url
            "cloud" -> "omb:open-settings" to "cloud"
            "organization" -> "omb:open-settings" to "organization"
            "install" -> {
                val target = Uri.parse(url).getQueryParameter("url")
                if (target.isNullOrBlank()) return
                "omb:package-install" to target
            }
            else -> return
        }
        val event = org.json.JSONObject.quote(delivery.first)
        val detail = org.json.JSONObject.quote(delivery.second)
        val script = "window.ombDeepLinkQueue = (window.ombDeepLinkQueue || []).concat([[$event, $detail]]);" +
            "window.dispatchEvent(new CustomEvent($event, { detail: $detail }))"
        view.evaluateJavascript(script, null)
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
                fun notify(title: String, body: String, silent: Boolean) {
                    postBotNotification(title, body, silent)
                }

                @android.webkit.JavascriptInterface
                fun openExternal(url: String) {
                    if (!url.startsWith("http://", ignoreCase = true) && !url.startsWith("https://", ignoreCase = true)) return
                    runOnUiThread { runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
                }

                @android.webkit.JavascriptInterface
                fun saveBackup(url: String, filename: String) {
                    if (filename.isBlank()) return
                    val parsed = loopbackHttpUrl(url) ?: return
                    if (!parsed.path.startsWith("/api/workspace-backup/download/")) return
                    beginSave(PendingWrite(filename, "application/json", parsed.toString(), null))
                }

                /** A server-served file (attachment, activity export): streamed with the WebView's session cookie. */
                @android.webkit.JavascriptInterface
                fun download(url: String, filename: String, mimeType: String) {
                    if (filename.isBlank()) return
                    val parsed = loopbackHttpUrl(url) ?: return
                    beginSave(PendingWrite(filename, mimeType.orOctetStream(), parsed.toString(), null))
                }

                /** A page-side Blob (blob:/data: URLs are unfetchable from here, so the UI ships the bytes). */
                @android.webkit.JavascriptInterface
                fun downloadBase64(filename: String, mimeType: String, base64: String) {
                    if (filename.isBlank() || base64.isBlank()) return
                    val bytes = runCatching {
                        android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                    }.getOrNull() ?: return
                    beginSave(PendingWrite(filename, mimeType.orOctetStream(), null, bytes))
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
                pageReady = true
                pendingDeepLink?.let { link ->
                    pendingDeepLink = null
                    dispatchDeepLink(link)
                }
                view.evaluateJavascript(
                    "(window.ombAndroidCaps ? 'bridge:' + ombAndroidCaps.capabilitiesJson().slice(0, 60) + ' notify:' + typeof ombAndroidCaps.notify : 'bridge:MISSING')",
                ) { result -> android.util.Log.d("OMBTest", "caps $result") }
            }
        }
        view.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            // Anchors with `download` reach here; a loopback file needs the session
            // cookie, which an external browser opened via ACTION_VIEW would not have.
            val loopback = loopbackHttpUrl(url)
            if (loopback != null) {
                beginSave(
                    PendingWrite(
                        filename = downloadFilename(contentDisposition, url),
                        mimeType = mimeType.orOctetStream(),
                        url = loopback.toString(),
                        bytes = null,
                    ),
                )
            } else {
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val origin = request.origin
                val fromApp = origin?.host == "127.0.0.1" || origin?.host == "localhost"
                val audio = request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                if (!fromApp || audio.isEmpty()) {
                    request.deny()
                    return
                }
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread { request.grant(audio.toTypedArray()) }
                } else {
                    pendingMicRequest = request to audio.toTypedArray()
                    requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
                }
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                chooserCallback?.onReceiveValue(null)
                chooserCallback = callback
                pendingCaptureUri = null
                val picker = params.createIntent().addCategory(Intent.CATEGORY_OPENABLE)
                val capture = cameraCaptureIntent(params)
                val intent = if (capture == null) picker else Intent(Intent.ACTION_CHOOSER).apply {
                    putExtra(Intent.EXTRA_INTENT, picker)
                    putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(capture))
                    // The system chooser forwards grants carried on itself, not on the
                    // initial intents, so the capture uri rides as clip data too.
                    pendingCaptureUri?.let { clipData = android.content.ClipData.newUri(contentResolver, "photo", it) }
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                }
                return try {
                    startActivityForResult(intent, REQUEST_FILE)
                    true
                } catch (e: android.content.ActivityNotFoundException) {
                    chooserCallback = null
                    pendingCaptureUri = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }
        root.addView(view)
        bootScreen.visibility = View.GONE
        webView = view
        pageReady = false
        view.loadUrl(NodeHostService.BASE_URL + "/")
    }

    private fun detachWebView() {
        val view = webView ?: return
        webView = null
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
        Log.w(TAG, "WebView detached for failure recovery")
    }

    private class PendingWrite(
        val filename: String,
        val mimeType: String,
        val url: String?,
        val bytes: ByteArray?,
    )

    @Volatile
    private var pendingSave: PendingWrite? = null

    private var pendingMicRequest: Pair<PermissionRequest, Array<String>>? = null

    private var pendingCaptureUri: Uri? = null

    /** Offers the camera beside the picker, for a file the app serves itself from its cache
     * directory (see [CaptureProvider]): a MediaStore output would need WRITE_EXTERNAL_STORAGE
     * at this targetSdk, and there is no androidx FileProvider in this app. */
    private fun cameraCaptureIntent(params: WebChromeClient.FileChooserParams): Intent? {
        val wantsImage = params.acceptTypes.isEmpty() || params.acceptTypes.any { it.startsWith("image") }
        if (!wantsImage) return null
        val dir = File(cacheDir, CAPTURE_DIR).apply { mkdirs() }
        val name = "IMG-${System.currentTimeMillis()}.jpg"
        if (!runCatching { File(dir, name).createNewFile() }.isSuccess) return null
        val uri = Uri.parse("content://$packageName.capture/$name")
        pendingCaptureUri = uri
        return Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
    }

    /** True when the camera app filled the output file its process wrote through [CaptureProvider]. */
    private fun captureLanded(uri: Uri): Boolean =
        runCatching { File(File(cacheDir, CAPTURE_DIR), uri.lastPathSegment ?: return false).length() > 0 }.getOrDefault(false)

    private fun loopbackHttpUrl(raw: String): java.net.URL? {
        val absolute = if (raw.startsWith("http")) raw else NodeHostService.BASE_URL + raw
        val parsed = runCatching { java.net.URL(absolute) }.getOrNull() ?: return null
        if (parsed.protocol != "http") return null
        if (parsed.host != "127.0.0.1" && parsed.host != "localhost") return null
        if (parsed.port != -1 && parsed.port != 8799) return null
        return parsed
    }

    private fun beginSave(request: PendingWrite) {
        pendingSave = request
        runOnUiThread {
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = request.mimeType
                putExtra(Intent.EXTRA_TITLE, request.filename)
            }
            runCatching { startActivityForResult(intent, REQUEST_SAVE) }
        }
    }

    private fun String?.orOctetStream(): String = if (this != null && contains("/")) this else "application/octet-stream"

    private fun downloadFilename(contentDisposition: String?, url: String): String {
        val disposition = contentDisposition.orEmpty()
        val encoded = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(disposition)?.groupValues?.get(1)
        val plain = Regex("filename=\"?([^\";]+)\"?").find(disposition)?.groupValues?.get(1)
        return encoded?.trim()?.takeIf { it.isNotEmpty() }
            ?: plain?.trim()?.takeIf { it.isNotEmpty() }
            ?: Uri.decode(url.substringBefore('?').substringAfterLast('/')).takeIf { it.isNotBlank() }
            ?: "download"
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_FILE) {
            val callback = chooserCallback
            chooserCallback = null
            val captured = pendingCaptureUri
            pendingCaptureUri = null
            val picked = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            // A camera app that wrote to EXTRA_OUTPUT returns RESULT_OK with no data uri of its own.
            val uris = picked ?: if (resultCode == Activity.RESULT_OK && captured != null && captureLanded(captured)) arrayOf(captured) else null
            if (captured != null && uris?.any { it == captured } != true) {
                runCatching { File(File(cacheDir, CAPTURE_DIR), captured.lastPathSegment ?: "").delete() }
            }
            callback?.onReceiveValue(uris)
            return
        }
        if (requestCode == REQUEST_SAVE) {
            val uri = data?.data
            val pending = pendingSave
            pendingSave = null
            if (resultCode == Activity.RESULT_OK && uri != null && pending != null) {
                Thread { writePendingSave(pending, uri) }.start()
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_MIC) return
        val (request, resources) = pendingMicRequest ?: return
        pendingMicRequest = null
        val allowed = grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED
        runOnUiThread { if (allowed) request.grant(resources) else request.deny() }
    }

    private fun writePendingSave(request: PendingWrite, uri: android.net.Uri) {
        runCatching {
            val stream = contentResolver.openOutputStream(uri, "w")
                ?: throw java.io.IOException("could not open the chosen file")
            stream.use { output ->
                val bytes = request.bytes
                if (bytes != null) {
                    output.write(bytes)
                } else {
                    val connection = java.net.URL(request.url).openConnection() as java.net.HttpURLConnection
                    connection.connectTimeout = 15_000
                    connection.readTimeout = 120_000
                    connection.useCaches = false
                    CookieManager.getInstance().getCookie(request.url)?.takeIf { it.isNotBlank() }?.let {
                        connection.setRequestProperty("Cookie", it)
                    }
                    try {
                        val status = connection.responseCode
                        if (status !in 200..299) {
                            val detail = connection.errorStream?.bufferedReader()?.use { it.readText().take(500) }.orEmpty()
                            throw java.io.IOException("server returned HTTP $status${if (detail.isBlank()) "" else ": $detail"}")
                        }
                        connection.inputStream.use { it.copyTo(output) }
                    } finally {
                        connection.disconnect()
                    }
                }
            }
            runOnUiThread { android.widget.Toast.makeText(this, "Saved ${request.filename}", android.widget.Toast.LENGTH_SHORT).show() }
        }.onFailure { cause ->
            runOnUiThread {
                android.widget.Toast.makeText(this, "Save failed: ${cause.message}", android.widget.Toast.LENGTH_LONG).show()
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val view = webView
        if (view == null) {
            super.onBackPressed()
            return
        }
        // The page owns the press while its drawer is open. The async callback cannot reach
        // super.onBackPressed(), and with enableOnBackInvokedCallback=false finish() is what
        // the default handler ends up doing anyway.
        view.evaluateJavascript("(window.ombAndroidCloseOverlay ? window.ombAndroidCloseOverlay() : false)") { consumed ->
            runOnUiThread {
                if (consumed == "true") return@runOnUiThread
                if (view.canGoBack()) view.goBack() else finish()
            }
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
        pendingMicRequest?.let { (request, _) -> runCatching { request.deny() } }
        pendingMicRequest = null
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
    private fun postBotNotification(title: String, body: String, silent: Boolean) {
        runCatching {
            val manager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            val channelId = if (silent) MESSAGES_SILENT_CHANNEL else MESSAGES_CHANNEL
            manager.createNotificationChannel(
                android.app.NotificationChannel(
                    channelId,
                    if (silent) "Bot messages (silent)" else "Bot messages",
                    if (silent) {
                        android.app.NotificationManager.IMPORTANCE_LOW
                    } else {
                        android.app.NotificationManager.IMPORTANCE_DEFAULT
                    },
                ),
            )
            val intent = android.app.PendingIntent.getActivity(
                this, 0, intent, android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = android.app.Notification.Builder(this, channelId)
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
        private const val REQUEST_MIC = 9
        internal const val CAPTURE_DIR = "camera-captures"
        private const val MESSAGES_CHANNEL = "omb-messages"
        private const val MESSAGES_SILENT_CHANNEL = "omb-messages-silent"
        private val WINDOW_COLOR = 0xFF070707.toInt()

        /** What src/lib/desktop.ts reads through the `ombAndroidCaps` WebView bridge:
         * the phone shell reports the local computer (its own Linux environment) as
         * ready, everything desktop-only (screen preview, dictation) as absent.
         * Screen capture needs getDisplayMedia, which a WebView never has, so the
         * Screen panel shows the proot desktop directly instead. */
        private const val CAPABILITIES_JSON =
            "{\"host\":{\"platform\":\"android\",\"label\":\"Android\",\"session\":\"headless\",\"packaged\":true}," +
                "\"windowChrome\":\"native\"," +
                "\"screenPreview\":{\"available\":false,\"interaction\":\"none\",\"reasonCode\":\"headless-environment\"}," +
                "\"dictation\":{\"available\":false,\"engine\":\"none\",\"onDevice\":false,\"reasonCode\":\"desktop-app-required\"}," +
                "\"localComputer\":{\"available\":true,\"support\":\"supported\",\"enabled\":true,\"status\":\"ready\"}}"
    }
}