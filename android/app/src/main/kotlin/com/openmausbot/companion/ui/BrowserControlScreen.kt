package com.openmausbot.companion.ui

// A bot's browser, watched and driven from the phone.
//
// ComputerScreen is the watching half. This is the other half: the same idea,
// but with a gesture layer behind it and a take/release gate in front, so the
// person can actually work rather than only supervise.
//
// Mirrors iOS's BrowserControlView.

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.APIError
import com.openmausbot.companion.core.BrowserFrame
import com.openmausbot.companion.core.BrowserLiveMessage
import com.openmausbot.companion.core.BrowserStatus
import com.openmausbot.companion.core.BrowserInputQueue
import com.openmausbot.companion.core.BrowserLiveSink
import com.openmausbot.companion.core.GestureCore
import com.openmausbot.companion.core.GestureIntent
import com.openmausbot.companion.core.GestureMode
import com.openmausbot.companion.core.RemotePoint
import com.openmausbot.companion.core.ViewTransform
import com.openmausbot.companion.core.ViewportMapping
import com.openmausbot.companion.core.bytes
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
fun BrowserControlScreen(botId: String, onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val state by session.state.collectAsState()

    val bot = remember(state, botId) { state.bot(botId) }
    if (bot == null) {
        LaunchedEffect(botId) { onBack() }
        return
    }

    val core = remember {
        GestureCore(
            GestureMode.DIRECT,
            ViewportMapping(1.0, 1.0, 1280.0, 720.0, ViewTransform.IDENTITY),
        )
    }
    val sink = remember { BrowserLiveSink() }

    var mode by remember { mutableStateOf(GestureMode.DIRECT) }
    var driving by remember { mutableStateOf(false) }
    var frame by remember { mutableStateOf<BrowserFrame?>(null) }
    var transform by remember { mutableStateOf(ViewTransform.IDENTITY) }
    var cursor by remember { mutableStateOf(RemotePoint(0.5, 0.5)) }
    var address by remember { mutableStateOf("") }
    var typed by remember { mutableStateOf("") }
    var latched by remember { mutableStateOf(0) }
    var queue by remember { mutableStateOf<BrowserInputQueue?>(null) }
    var viewerId by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf(BrowserStatus(false, false, 1280.0, 720.0)) }
    var failure by remember { mutableStateOf<String?>(null) }

    val transport = remember(botId) { session.browserLive() }

    // One stream for as long as the screen is up. Reconnection is not handled
    // here for the same reason it is not in the main event stream: only
    // something that knows whether the view is on screen can decide.
    LaunchedEffect(transport, botId) {
        val live = transport ?: return@LaunchedEffect
        runCatching {
            live.live(botId).collect { message ->
                when (message) {
                    is BrowserLiveMessage.Frame -> {
                        frame = message.frame
                        sink.frameWidth = message.frame.deviceWidth
                        sink.frameHeight = message.frame.deviceHeight
                        viewerId?.let { id ->
                            runCatching {
                                live.action(botId, id, buildJsonObject {
                                    put("type", "ack")
                                    put("seq", message.frame.seq)
                                })
                            }
                        }
                    }
                    is BrowserLiveMessage.Status -> {
                        status = message.status
                        if (frame == null) {
                            sink.frameWidth = message.status.viewportWidth
                            sink.frameHeight = message.status.viewportHeight
                        }
                    }
                    is BrowserLiveMessage.Url -> address = message.url
                    is BrowserLiveMessage.Viewer -> {
                        viewerId = message.id
                        queue = BrowserInputQueue(
                            scope = scope,
                            send = { body -> live.send(botId, message.id, body) },
                            onError = { failure = it.message },
                        )
                    }
                    is BrowserLiveMessage.Error -> failure = message.message
                    is BrowserLiveMessage.Tabs -> Unit
                }
            }
        }.onFailure { failure = explainBrowserFailure(it) }
    }

    // A key or button left down on the remote outlives the session, and
    // nothing on the far side will ever lift it.
    DisposableEffect(botId) {
        onDispose {
            val held = core.flush()
            scope.launch {
                queue?.let { pending ->
                    held.forEach { intent -> sink.bodies(intent).forEach { pending.enqueue(it) } }
                    pending.drain()
                }
            }
        }
    }

    fun send(intents: List<GestureIntent>) {
        if (!driving) return
        val pending = queue ?: return
        val bodies = intents.flatMap(sink::bodies)
        if (bodies.isEmpty()) return
        scope.launch { bodies.forEach { pending.enqueue(it) } }
    }

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextField(
                value = address,
                onValueChange = { address = it },
                singleLine = true,
                modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = {
                    val id = viewerId
                    val live = transport
                    if (id != null && live != null && address.isNotBlank()) {
                        val target = if ("://" in address) address else "https://\$address"
                        scope.launch {
                            runCatching {
                                live.action(botId, id, buildJsonObject {
                                    put("type", "navigate")
                                    put("url", target)
                                })
                            }
                        }
                    }
                }),
            )
            FilterChip(
                selected = mode == GestureMode.DIRECT,
                onClick = { mode = GestureMode.DIRECT },
                label = { Text("Touch") },
            )
            FilterChip(
                selected = mode == GestureMode.TRACKPAD,
                onClick = { mode = GestureMode.TRACKPAD },
                label = { Text("Pad") },
            )
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            val bitmap = remember(frame?.seq) {
                frame?.bytes()?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            }
            if (bitmap != null) {
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = "${bot.name}'s browser",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().scale(transform.scale.toFloat()),
                )
            } else {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }

            Box(
                Modifier
                    .fillMaxSize()
                    .browserTouchSurface(
                        core = core,
                        mode = mode,
                        driving = driving,
                        frameWidth = frame?.deviceWidth ?: 1280.0,
                        frameHeight = frame?.deviceHeight ?: 720.0,
                        onIntents = ::send,
                        onViewState = { newTransform, newCursor ->
                            transform = newTransform
                            cursor = newCursor
                        },
                    ),
            )

            // Drawn locally at frame rate so it never waits for the network —
            // the whole reason trackpad mode feels usable.
            if (mode == GestureMode.TRACKPAD && driving) {
                val density = LocalDensity.current
                Box(
                    Modifier
                        .offset(
                            x = with(density) { (cursor.x * 1000).toInt().toDp() },
                            y = with(density) { (cursor.y * 1000).toInt().toDp() },
                        )
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.6f)),
                )
            }
        }

        // Without this bar there is no Ctrl-L, no Escape and no Tab between
        // fields — and therefore no real work.
        if (driving) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ModifierChip("ctrl", 2, latched) { latched = latched xor it }
                ModifierChip("alt", 1, latched) { latched = latched xor it }
                ModifierChip("meta", 4, latched) { latched = latched xor it }
                ModifierChip("shift", 8, latched) { latched = latched xor it }
                for ((label, name) in NAMED_KEYS) {
                    OutlinedButton(onClick = {
                        send(listOf(GestureIntent.Key(name, latched)))
                        latched = 0
                    }) { Text(label) }
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (driving) {
                Button(
                    onClick = {
                        driving = false
                        latched = 0
                        scope.launch {
                            // Let go of what the remote is holding before
                            // handing it back; stale travel is not worth
                            // waiting for.
                            queue?.drain()
                            val id = viewerId
                            if (transport != null && id != null) {
                                runCatching {
                                    transport.action(botId, id, buildJsonObject { put("type", "release") })
                                }
                            }
                        }
                    },
                    modifier = Modifier.weight(1f),
                ) { Text("Hand back") }
            } else {
                Button(
                    onClick = {
                        val id = viewerId ?: return@Button
                        val live = transport ?: return@Button
                        scope.launch {
                            runCatching {
                                live.action(botId, id, buildJsonObject { put("type", "take") })
                            }.onSuccess {
                                driving = true
                                failure = null
                            }.onFailure { failure = explainBrowserFailure(it) }
                        }
                    },
                    enabled = status.connected && viewerId != null,
                    modifier = Modifier.weight(1f),
                ) { Text("Take control") }
            }
        }
    }
}

/** The 429 from a full viewer table is a real situation with a real answer,
 * not a generic failure worth shrugging at. */
private fun explainBrowserFailure(error: Throwable): String = when {
    error is APIError.Status && error.code == 429 ->
        "This browser is already open on your computer. Close it there, then try again."
    error is APIError.Status && error.code == 403 ->
        "Browser control is off for this device. Enable it on your computer."
    else -> error.message ?: "The browser stream stopped."
}

private val NAMED_KEYS = listOf(
    "esc" to "Escape",
    "tab" to "Tab",
    "↑" to "ArrowUp",
    "↓" to "ArrowDown",
    "←" to "ArrowLeft",
    "→" to "ArrowRight",
    "⏎" to "Enter",
    "⌫" to "Backspace",
)

@Composable
private fun ModifierChip(label: String, bit: Int, latched: Int, onToggle: (Int) -> Unit) {
    FilterChip(
        selected = latched and bit != 0,
        onClick = { onToggle(bit) },
        label = { Text(label) },
    )
}
