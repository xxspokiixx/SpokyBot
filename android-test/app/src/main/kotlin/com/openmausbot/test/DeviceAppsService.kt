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
            "tap" -> tap(command.getDouble("x"), command.getDouble("y"))
            "tap_text" -> tapText(
                command.getString("text"),
                command.optBoolean("exact"),
                command.optInt("index", 0),
            )
            "type" -> typeText(command.getString("text"))
            "press" -> press(command.getString("key"))
            "swipe" -> swipe(command.getString("direction"))
            else -> error("unknown action: ${command.optString("action")}")
        }
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

    private fun tap(x: Double, y: Double): JSONObject =
        if (x < 0 || y < 0 || x > 100000 || y > 100000) {
            error("Invalid coordinates")
        } else if (dispatchTap(x.toInt(), y.toInt())) {
            JSONObject().put("ok", true).put("tapped", "${x.toInt()},${y.toInt()}")
        } else {
            error("Android did not accept the tap gesture")
        }

    private fun dispatchTap(x: Int, y: Int): Boolean {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()); lineTo(x + 1f, y + 1f) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
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

    private fun typeText(text: String): JSONObject {
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
        val arguments = android.os.Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        return if (target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)) {
            JSONObject().put("ok", true).put("typed", text.length)
        } else {
            error("The focused field did not accept text")
        }
    }

    private fun press(key: String): JSONObject {
        val action = when (key) {
            "back", "escape" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recent" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
            else -> -1
        }
        if (action == -1) return error("Key \"$key\" is not available on-device; use back, home, recent, notifications or quick_settings")
        return if (performGlobalAction(action)) {
            JSONObject().put("ok", true).put("pressed", key)
        } else {
            error("Android did not accept the key \"$key\"")
        }
    }

    private fun swipe(direction: String): JSONObject {
        val metrics: DisplayMetrics = resources.displayMetrics
        val centerX = metrics.widthPixels / 2f
        val centerY = metrics.heightPixels / 2f
        val spanX = metrics.widthPixels * 0.4f
        val spanY = metrics.heightPixels * 0.4f
        val (fromX, fromY, toX, toY) = when (direction) {
            "up" -> listOf(centerX, centerY + spanY / 2, centerX, centerY - spanY / 2)
            "down" -> listOf(centerX, centerY - spanY / 2, centerX, centerY + spanY / 2)
            "left" -> listOf(centerX + spanX / 2, centerY, centerX - spanX / 2, centerY)
            "right" -> listOf(centerX - spanX / 2, centerY, centerX + spanX / 2, centerY)
            else -> return error("direction must be up, down, left or right")
        }
        val path = Path().apply {
            moveTo(fromX, fromY)
            lineTo(toX, toY)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 220))
            .build()
        return if (dispatchGesture(gesture, null, null)) {
            JSONObject().put("ok", true).put("swiped", direction)
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