package com.openmausbot.test

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.util.DisplayMetrics
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

/**
 * The phone build's "connected apps": a granted AccessibilityService the
 * harness's device-apps MCP drives over a private UNIX socket. It can list and
 * launch installed apps, read the live screen's accessibility tree, tap, type
 * into the focused field, swipe, and press navigation keys — the same tool
 * surface the desktop's adb phone proxy exposes, so models trained on OMB's
 * phone-harness skill work unchanged.
 */
class DeviceAppsService : AccessibilityService() {
    private var server: ServerSocket? = null

    companion object {
        /** Loopback-only TCP: matches the harness's OMB_PORT convention. */
        const val APPS_PORT = 8798
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        // Accessibility re-binds the same live service (settings rewrites, user
        // toggles): without this guard the second pass kills the first server.
        if (server != null) return
        try {
            // Loopback TCP, not a filesystem socket: this device mounts a
            // different view of the app's data dir for legacy-target services,
            // where a bound socket's file is invisible to the rest of the app.
            val bound = ServerSocket(APPS_PORT, 4, InetAddress.getByName("127.0.0.1"))
            server = bound
            thread(name = "device-apps-socket", isDaemon = true) { acceptLoop() }
            android.util.Log.d("OMBTest", "apps service connected; tcp 127.0.0.1:$APPS_PORT")
        } catch (e: Exception) {
            android.util.Log.e("OMBTest", "apps socket failed: ${e}")
            val note = File(filesDir, "logs/device-apps-error.txt")
            runCatching { note.parentFile?.mkdirs(); note.writeText(e.toString()) }
        }
    }

    override fun onDestroy() {
        runCatching { server?.close() }
        server = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    private fun acceptLoop() {
        while (true) {
            val socket = try {
                server?.accept() ?: return
            } catch (_: Exception) {
                return
            }
            thread(name = "device-apps-client", isDaemon = true) { serveClient(socket) }
        }
    }

    private fun serveClient(socket: java.net.Socket) {
        socket.use { client ->
            val input = BufferedReader(InputStreamReader(client.getInputStream()))
            val output = PrintWriter(client.getOutputStream(), true)
            while (true) {
                val line = input.readLine() ?: return
                val answer = try {
                    handle(JSONObject(line))
                } catch (e: Exception) {
                    error(e.message ?: "command failed")
                }
                output.println(answer.toString())
            }
        }
    }

    private fun error(message: String): JSONObject =
        JSONObject().put("ok", false).put("error", message)

    private fun handle(command: JSONObject): JSONObject {
        return when (command.optString("action")) {
            "status" -> JSONObject().put("ok", true).put("available", true).put("service", "connected")
            "screen" -> screen()
            "apps" -> apps(command.optString("query"))
            "open" -> open(command.getString("name"))
            "tap" -> tap(
                command.getDouble("x"), command.getDouble("y"),
                if (command.has("duration_ms")) command.optInt("duration_ms", 60) else 60,
            )
            "tap_text" -> tapText(
                command.getString("text"),
                command.optBoolean("exact"),
                command.optInt("index", 0),
            )
            "type" -> typeText(command.getString("text"), command.optBoolean("clear"))
            "press" -> press(command.getString("key"))
            "swipe" -> swipe(
                command.getString("direction"),
                if (command.has("x")) command.getDouble("x") else null,
                if (command.has("y")) command.getDouble("y") else null,
                if (command.has("distance")) command.getDouble("distance") else null,
                command.optInt("duration_ms", 220),
            )
            else -> error("unknown action: ${command.optString("action")}")        }
    }

    private fun rootNode(): AccessibilityNodeInfo? = rootInActiveWindow

    private fun collectNodes(root: AccessibilityNodeInfo, cap: Int): List<JSONObject> {
        val nodes = mutableListOf<JSONObject>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty() && nodes.size < cap) {
            val node = queue.removeFirst()
            val rect = Rect()
            node.getBoundsInScreen(rect)
            val label = node.text?.toString() ?: node.contentDescription?.toString() ?: ""
            // The desktop proxy lists every ui dump node; labels-or-ids keep the same
            // shape while skipping pure layout containers with nothing to say.
            if (label.isNotBlank() || node.viewIdResourceName != null) {
                nodes.add(
                    JSONObject()
                        .put("text", node.text?.toString() ?: "")
                        .put("description", node.contentDescription?.toString() ?: "")
                        .put("id", node.viewIdResourceName ?: "")
                        .put("className", node.className?.toString() ?: "")
                        .put("bounds", JSONArray(listOf(rect.left, rect.top, rect.right, rect.bottom))),
                )
            }
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let { queue.add(it) }
            }
        }
        return nodes
    }

    private fun screen(): JSONObject {
        val root = rootNode() ?: return error("No active window is available to read")
        return JSONObject().put("ok", true).put("nodes", JSONArray(collectNodes(root, 250)))
    }

    private fun apps(query: String): JSONObject {
        val manager = packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val entries = manager.queryIntentActivities(intent, 0)
            .map { resolve -> resolve.activityInfo }
            .map { info -> (info.loadLabel(manager)?.toString() ?: "") to info.packageName }
            .sortedBy { it.first.lowercase() }
            .filter { (label, packageName) ->
                query.isBlank() || label.contains(query, ignoreCase = true) || packageName.contains(query, ignoreCase = true)
            }
        return JSONObject().put("ok", true).put("apps", JSONArray(entries.map { (label, packageName) -> "$label $packageName" }))
    }

    private fun open(name: String): JSONObject {
        val manager = packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val candidates = manager.queryIntentActivities(intent, 0)
            .map { resolve -> resolve.activityInfo }
            .map { info -> (info.loadLabel(manager)?.toString() ?: "") to info.packageName }
        val query = name.trim().lowercase()
        val matches = candidates.filter { (label, packageName) ->
            label.lowercase() == query || packageName.substringAfterLast('.').lowercase() == query
        }.ifEmpty {
            candidates.filter { (label, packageName) -> label.contains(query, true) || packageName.contains(query, true) }
        }
        val unique = matches.distinctBy { it.second }
        if (unique.size != 1) {
            return error(
                if (unique.isEmpty()) "No installed launchable app matches \"$name\""
                else "App name is ambiguous: ${unique.take(5).joinToString(", ") { "${it.first} ${it.second}" }}",
            )
        }
        val packageName = unique.first().second
        val launch = manager.getLaunchIntentForPackage(packageName)
            ?: return error("App $packageName has no launch intent")
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            startActivity(launch)
            JSONObject().put("ok", true).put("opened", unique.first().first).put("package", packageName)
        } catch (e: Exception) {
            error("Android refused to start $packageName: ${e.message}")
        }
    }

    private fun tap(x: Double, y: Double, durationMs: Int = 60): JSONObject =
        if (x < 0 || y < 0 || x > 100000 || y > 100000) {
            error("Invalid coordinates")
        } else if (durationMs < 1 || durationMs > 10000) {
            error("duration_ms must be a whole number from 1 to 10000")
        } else if (dispatchTap(x.toInt(), y.toInt(), durationMs)) {
            JSONObject().put("ok", true)
                .put("tapped", if (durationMs > 60) "${x.toInt()},${y.toInt()} held ${durationMs} ms" else "${x.toInt()},${y.toInt()}")
        } else {
            error("Android did not accept the tap gesture")
        }

    private fun dispatchTap(x: Int, y: Int, durationMs: Int = 60): Boolean {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()); lineTo(x + 1f, y + 1f) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs.toLong()))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun tapText(text: String, exact: Boolean, index: Int): JSONObject {
        val root = rootNode() ?: return error("No active window is available to read")
        val query = text.trim().lowercase()
        val hits = mutableListOf<AccessibilityNodeInfo>()
        walk(root) { node ->
            val labels = listOfNotNull(node.text?.toString(), node.contentDescription?.toString())
                .map { it.trim().lowercase() }
            if (labels.any { label -> if (exact) label == query else label.contains(query) }) {
                hits.add(node)
            }
        }
        if (hits.isEmpty()) return error("No visible text matches \"$text\"")
        if (index < 0 || index >= hits.size) return error("Only ${hits.size} match(es) for \"$text\"; index $index is out of range")
        val rect = Rect()
        hits[index].getBoundsInScreen(rect)
        val x = (rect.left + rect.right) / 2
        val y = (rect.top + rect.bottom) / 2
        return if (dispatchTap(x, y)) {
            JSONObject().put("ok", true).put("tapped", hits[index].text?.toString() ?: hits[index].contentDescription?.toString() ?: text)
        } else {
            error("Android did not accept the tap gesture")
        }
    }

    private fun typeText(text: String, clear: Boolean): JSONObject {
        if (text.length > 5000) return error("Text is too long")
        val root = rootNode() ?: return error("No active window is available to read")
        var focused: AccessibilityNodeInfo? = null
        walk(root) { node ->
            if (node.isFocused && node.isEditable) focused = node
        }
        if (focused == null) {
            walk(root) { node -> if (node.isEditable && focused == null) focused = node }
        }
        val target = focused ?: return error("No focused editable field: tap the field first, then type")
        // ACTION_SET_TEXT replaces what the field holds, so appending is this plus the text already there: `input text` on
        // a cabled phone types at the cursor, and a batch that taps a search box and types expects the same.
        val existing = if (clear) "" else target.text?.toString().orEmpty()
        val next = existing + text
        val arguments = android.os.Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, next) }
        return if (target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)) {
            JSONObject().put("ok", true).put("typed", text.length).put("cleared", clear)
        } else {
            error("The focused field did not accept text")
        }
    }

    private fun press(key: String): JSONObject {
        // There is no global action that wakes the screen, so a wake lock with ACQUIRE_CAUSES_WAKEUP does it (the
        // WAKE_LOCK permission is normal: granted at install, no prompt). Sleep does have one, from API 28.
        if (key == "wakeup") {
            return try {
                val manager = getSystemService(POWER_SERVICE) as android.os.PowerManager
                @Suppress("DEPRECATION")
                manager.newWakeLock(android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP, "omb:wakeup")
                    .apply { acquire(3_000L) }
                JSONObject().put("ok", true).put("pressed", key)
            } catch (e: Exception) {
                error("Android refused to wake the screen: ${e.message}")
            }
        }
        val action = when (key) {
            "back", "escape" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recent" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
            "sleep" -> if (android.os.Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_LOCK_SCREEN else -2
            else -> -1
        }
        if (action == -2) return error("sleep needs Android 9 or later on this phone")
        if (action == -1) return error("Key \"$key\" is not available on-device; use back, home, recent, wakeup, sleep, notifications or quick_settings")
        return if (performGlobalAction(action)) {
            JSONObject().put("ok", true).put("pressed", key)
        } else {
            error("Android did not accept the key \"$key\"")
        }
    }

    private fun swipe(direction: String, x: Double?, y: Double?, distance: Double?, durationMs: Int): JSONObject {
        if (durationMs < 20 || durationMs > 10000) return error("duration_ms must be a whole number from 20 to 10000")
        val metrics: DisplayMetrics = resources.displayMetrics
        val centerX = metrics.widthPixels / 2f
        val centerY = metrics.heightPixels / 2f
        val spanX = metrics.widthPixels * 0.4f
        val spanY = metrics.heightPixels * 0.4f
        val (fromX, fromY, toX, toY) = if (x == null && y == null && distance == null) {
            when (direction) {
                "up" -> listOf(centerX, centerY + spanY / 2, centerX, centerY - spanY / 2)
                "down" -> listOf(centerX, centerY - spanY / 2, centerX, centerY + spanY / 2)
                "left" -> listOf(centerX + spanX / 2, centerY, centerX - spanX / 2, centerY)
                "right" -> listOf(centerX - spanX / 2, centerY, centerX + spanX / 2, centerY)
                else -> return error("direction must be up, down, left or right")
            }
        } else {
            // A chosen start and distance scroll a list, a pane or a picker wheel by an exact amount.
            val startX = (x ?: centerX.toDouble()).toFloat()
            val startY = (y ?: centerY.toDouble()).toFloat()
            val length = (distance ?: (minOf(metrics.widthPixels, metrics.heightPixels) / 2.0)).toFloat()
            if (startX < 0 || startY < 0 || startX > metrics.widthPixels || startY > metrics.heightPixels) {
                return error("x and y must fall on the screen: 0 to ${metrics.widthPixels} and 0 to ${metrics.heightPixels}")
            }
            if (length <= 0f) return error("distance must be a positive number of pixels on this screen")
            // A gesture whose finger leaves the screen makes Android's own GestureDescription throw (a null touch point), so
            // the end is refused here with the length that would fit instead.
            val (endX, endY) = when (direction) {
                "up" -> startX to startY - length
                "down" -> startX to startY + length
                "left" -> startX - length to startY
                "right" -> startX + length to startY
                else -> return error("direction must be up, down, left or right")
            }
            if (endX < 0 || endY < 0 || endX > metrics.widthPixels || endY > metrics.heightPixels) {
                return error("a $direction swipe of ${length.toInt()} px from $startX,$startY ends off the screen; the screen is ${metrics.widthPixels} by ${metrics.heightPixels}")
            }
            listOf(startX, startY, endX, endY)
        }
        val path = Path().apply {
            moveTo(fromX, fromY)
            lineTo(toX, toY)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs.toLong()))
            .build()
        return if (dispatchGesture(gesture, null, null)) {
            JSONObject().put("ok", true).put("swiped", if (durationMs == 220) direction else "$direction over $durationMs ms")
        } else {
            error("Android did not accept the swipe gesture")
        }
    }

    private fun walk(node: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo) -> Unit) {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(node)
        var visited = 0
        while (queue.isNotEmpty() && visited < 800) {
            val current = queue.removeFirst()
            visited += 1
            visit(current)
            for (index in 0 until current.childCount) {
                current.getChild(index)?.let { queue.add(it) }
            }
        }
    }
}