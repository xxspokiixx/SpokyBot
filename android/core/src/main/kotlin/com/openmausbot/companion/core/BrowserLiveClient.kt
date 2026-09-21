package com.openmausbot.companion.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * What arrives on `GET /api/bots/:id/browser/live`.
 *
 * The server normalises every message before it reaches us
 * (`normalizeBrowserLiveMessage`), so these are the only shapes possible and
 * an unknown one is a protocol change, not untrusted input.
 */
sealed interface BrowserLiveMessage {
    data class Frame(val frame: BrowserFrame) : BrowserLiveMessage
    data class Status(val status: BrowserStatus) : BrowserLiveMessage
    data class Url(val url: String) : BrowserLiveMessage
    data class Tabs(val tabs: List<BrowserTab>) : BrowserLiveMessage
    data class Viewer(val id: String) : BrowserLiveMessage
    data class Error(val message: String) : BrowserLiveMessage
}

data class BrowserFrame(
    val seq: Int,
    /** Base64 JPEG or PNG, exactly as the server framed it. */
    val data: String,
    val format: String,
    val deviceWidth: Double,
    val deviceHeight: Double,
)

data class BrowserStatus(
    val connected: Boolean,
    val screencasting: Boolean,
    val viewportWidth: Double,
    val viewportHeight: Double,
)

data class BrowserTab(
    val tabId: String,
    val title: String,
    val url: String,
    val active: Boolean,
)

/**
 * Decodes one server message.
 *
 * Written by hand because the wire is a tagged union keyed on `type`, and
 * because a message we do not understand must be dropped rather than tear
 * down a stream the person is watching.
 *
 * Mirrors CompanionCore's `BrowserLiveDecoder`.
 */
object BrowserLiveDecoder {
    private val json = Json { ignoreUnknownKeys = true }

    private fun JsonObject.string(key: String) = this[key]?.jsonPrimitive?.contentOrNull
    private fun JsonObject.bool(key: String) = this[key]?.jsonPrimitive?.booleanOrNull
    private fun JsonObject.number(key: String) = this[key]?.jsonPrimitive?.doubleOrNull

    fun message(raw: String): BrowserLiveMessage? {
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        return when (root.string("type")) {
            "frame" -> {
                val seq = root["seq"]?.jsonPrimitive?.intOrNull ?: return null
                val data = root.string("data") ?: return null
                val metadata = runCatching { root["metadata"]!!.jsonObject }.getOrNull() ?: return null
                val width = metadata.number("deviceWidth") ?: return null
                val height = metadata.number("deviceHeight") ?: return null
                BrowserLiveMessage.Frame(
                    BrowserFrame(seq, data, root.string("format") ?: "jpeg", width, height),
                )
            }

            "status" -> BrowserLiveMessage.Status(
                BrowserStatus(
                    connected = root.bool("connected") ?: return null,
                    screencasting = root.bool("screencasting") ?: false,
                    viewportWidth = root.number("viewportWidth") ?: 1280.0,
                    viewportHeight = root.number("viewportHeight") ?: 720.0,
                ),
            )

            "url" -> BrowserLiveMessage.Url(root.string("url") ?: return null)

            "tabs" -> {
                val array = runCatching { root["tabs"]!!.jsonArray }.getOrNull() ?: return null
                BrowserLiveMessage.Tabs(
                    array.mapNotNull { element ->
                        val tab = runCatching { element.jsonObject }.getOrNull() ?: return@mapNotNull null
                        val id = tab.string("tabId") ?: return@mapNotNull null
                        BrowserTab(
                            tabId = id,
                            title = tab.string("title") ?: "",
                            url = tab.string("url") ?: "",
                            active = tab.bool("active") ?: false,
                        )
                    },
                )
            }

            "viewer" -> BrowserLiveMessage.Viewer(root.string("viewerId") ?: return null)

            "error" -> BrowserLiveMessage.Error(
                root.string("message") ?: "The browser stream was interrupted.",
            )

            // A type we do not know is a protocol change, not a reason to tear
            // down a stream the person is watching.
            else -> null
        }
    }
}

/** Decoded frame bytes, or null when the base64 was not what it claimed.
 *
 * java.util.Base64 rather than android.util.Base64: :core is a plain JVM
 * module so its tests run without an emulator, and pulling in an Android type
 * here would end that. */
fun BrowserFrame.bytes(): ByteArray? =
    runCatching { java.util.Base64.getDecoder().decode(data) }.getOrNull()
