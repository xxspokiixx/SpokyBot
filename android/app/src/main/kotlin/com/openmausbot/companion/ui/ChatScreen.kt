package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.Message
import java.util.Locale
import kotlinx.coroutines.launch

/**
 * One conversation: the transcript, the approval cards, and the composer — the
 * port of `ios/App/ChatView.swift`.
 *
 * The transcript is whatever the harness folded — settled text, tool chips,
 * option cards, screenshots. This renders those and nothing else; it does not
 * re-derive anything from provider events, because the server already did that
 * and having two folds is how two clients start disagreeing.
 */
@Composable
fun ChatScreen(threadId: String, onBack: () -> Unit, onOpenComputer: (String) -> Unit) {
    val session = LocalCompanion.current.session
    val state by session.state.collectAsState()

    // A notification tap at a cold start arrives before the fleet is hydrated:
    // wait for it rather than concluding the thread is gone and bouncing back to
    // the roster, which would make the tap open nothing.
    when (val resolution = remember(state, threadId) { ThreadResolution.resolve(state, threadId) }) {
        ThreadResolution.Result.Waiting -> OpeningThread(onBack)
        ThreadResolution.Result.Gone -> LaunchedEffect(threadId) { onBack() }
        // The live chat record, so busy/unread stay current as frames land.
        is ThreadResolution.Result.Open ->
            LoadedChat(resolution.chat, state, onBack, onOpenComputer)
    }
}

/** The transcript is on its way. Leaving is still possible while it is. */
@Composable
private fun OpeningThread(onBack: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                modifier = Modifier
                    .size(32.dp)
                    .background(secondaryTint.copy(alpha = 0.16f), CircleShape)
                    .clickable(onClick = onBack)
                    .padding(6.dp),
            )
        }
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
        }
    }
}

@Composable
private fun LoadedChat(
    chat: Chat,
    state: CompanionState,
    onBack: () -> Unit,
    onOpenComputer: (String) -> Unit,
) {
    // The bot's *current* thread, not the one the destination named. Switching or
    // creating a task moves a bot to another thread; everything below re-keys on
    // that, so the screen follows the bot to the task it is now in.
    val threadId = chat.threadId
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    var showingTasks by remember { mutableStateOf(false) }
    val focusedMessageId by session.focusedMessageId.collectAsState()

    val transcript = remember(state, threadId) { state.visibleTranscript(threadId) }
    val streaming = state.streaming[threadId]
    val reasoning = state.reasoning[threadId]
    val liveText = streaming?.takeIf { it.isNotEmpty() }
    val liveReasoning = reasoning?.takeIf { it.isNotEmpty() && liveText == null }
    val hasMore = state.hasMore[threadId] == true

    var draft by rememberSaveable(threadId) { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Opening a chat is what marks it read, exactly as on the desktop — and a
    // message can arrive while it is already on screen, so this keys on the bit
    // rather than running once.
    LaunchedEffect(threadId, chat.unread) {
        if (chat.unread) session.markRead(chat)
    }

    val headerCount = if (hasMore) 1 else 0
    val liveCount = if (liveText != null || liveReasoning != null) 1 else 0
    val itemCount = headerCount + transcript.size + liveCount

    // A conversation grows from the bottom: opening a chat starts on the newest
    // message rather than the oldest.
    var settled by remember(threadId) { mutableStateOf(false) }
    LaunchedEffect(threadId, itemCount) {
        if (settled || itemCount == 0) return@LaunchedEffect
        listState.scrollToItem(itemCount - 1)
        settled = true
    }
    LaunchedEffect(threadId, transcript.lastOrNull()?.id) {
        if (!settled || itemCount == 0) return@LaunchedEffect
        listState.animateScrollToItem(itemCount - 1)
    }
    // Follow the text as it arrives. Keyed on length rather than the string so
    // this fires once per delta batch, and without animation — animating every
    // token turns a smooth stream into a stutter.
    LaunchedEffect(threadId, liveText?.length ?: 0) {
        if (liveCount == 0 || itemCount == 0) return@LaunchedEffect
        listState.scrollToItem(itemCount - 1)
    }
    // A search hit lands on its message.
    LaunchedEffect(focusedMessageId, transcript.size) {
        val target = focusedMessageId ?: return@LaunchedEffect
        val index = transcript.indexOfFirst { it.id == target }
        if (index < 0) return@LaunchedEffect
        listState.scrollToItem(headerCount + index)
        session.consumeFocus(target)
        settled = true
    }

    Column(modifier = Modifier.fillMaxSize()) {
        ChatToolbar(
            chat = chat,
            onBack = onBack,
            onStop = {
                val bot = (chat as? Chat.BotChat)?.bot ?: return@ChatToolbar
                scope.launch { session.interrupt(bot) }
            },
            onWatchComputer = {
                val bot = (chat as? Chat.BotChat)?.bot ?: return@ChatToolbar
                onOpenComputer(bot.id)
            },
            onTasks = { showingTasks = true },
            onShare = { format ->
                scope.launch {
                    val exported = session.export(threadId, format.wire) ?: return@launch
                    environment.shareTranscript(exported, format)?.let { session.actionError = it }
                }
            },
        )

        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (hasMore) {
                item(key = LOAD_EARLIER_KEY) {
                    TextButton(
                        onClick = {
                            // Keep the reader where they were: after older
                            // messages are prepended, sit back on the one that
                            // used to be at the top.
                            val anchor = transcript.firstOrNull()?.id
                            scope.launch {
                                session.loadOlder(threadId)
                                if (anchor == null) return@launch
                                val fresh = session.state.value
                                val index = fresh.visibleTranscript(threadId)
                                    .indexOfFirst { it.id == anchor }
                                if (index < 0) return@launch
                                // The "load earlier" row is item 0 for as long as
                                // there is still more to fetch.
                                val offset = if (fresh.hasMore[threadId] == true) 1 else 0
                                listState.scrollToItem(index + offset)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Load earlier messages", fontSize = 13.sp)
                    }
                }
            }

            itemsIndexedKeyed(transcript) { index, message ->
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    // A gap in time is worth marking; a timestamp on every
                    // message is just noise.
                    if (TranscriptLayout.startsNewStretch(transcript, index)) {
                        Text(
                            text = RelativeStamp.separator(
                                message.at,
                                System.currentTimeMillis(),
                                locale = Locale.getDefault(),
                            ),
                            fontSize = 13.sp,
                            color = secondaryTint,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 6.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                    MessageRow(chat = chat, message = message)
                }
            }

            if (liveCount == 1) {
                item(key = LIVE_BUBBLE_KEY) {
                    StreamingBubble(text = liveText, reasoning = liveReasoning)
                }
            }
        }

        if (showingTasks) {
            (chat as? Chat.BotChat)?.let {
                TaskSheet(botId = it.bot.id, onDismiss = { showingTasks = false })
            }
        }

        Composer(
            name = chat.name,
            draft = draft,
            onDraftChange = { draft = it },
            onSend = {
                val text = draft.trim()
                if (text.isEmpty()) return@Composer
                draft = ""
                // Deliberately not disabled while the bot is busy: the harness
                // answers 409 and Session surfaces "The bot is busy — stop it
                // first." That is a clearer answer than a dead button.
                scope.launch { session.send(text, chat) }
            },
        )
    }
}

private const val LOAD_EARLIER_KEY = "companion.loadEarlier"
private const val LIVE_BUBBLE_KEY = "companion.live"

/** `itemsIndexed` with the message id as the key — one call site, one helper. */
private fun androidx.compose.foundation.lazy.LazyListScope.itemsIndexedKeyed(
    messages: List<Message>,
    content: @Composable (Int, Message) -> Unit,
) {
    items(
        count = messages.size,
        key = { messages[it].id },
        itemContent = { index -> content(index, messages[index]) },
    )
}

@Composable
private fun ChatToolbar(
    chat: Chat,
    onBack: () -> Unit,
    onStop: () -> Unit,
    onWatchComputer: () -> Unit,
    onTasks: () -> Unit,
    onShare: (ShareFormat) -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val isBot = chat is Chat.BotChat

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = "Back",
            modifier = Modifier
                .size(32.dp)
                .background(secondaryTint.copy(alpha = 0.16f), CircleShape)
                .clickable(onClick = onBack)
                .padding(6.dp),
        )

        Row(
            modifier = Modifier
                .background(secondaryTint.copy(alpha = 0.16f), CircleShape)
                .padding(start = 6.dp, end = 14.dp, top = 5.dp, bottom = 5.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MausAvatar(color = chat.color, size = 26.dp)
            Text(chat.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        Spacer(Modifier.weight(1f))

        // Stop is a bot action. A room has no single runner to interrupt (§12).
        if (isBot && chat.busy) {
            TextButton(onClick = onStop) { Text("Stop") }
        }

        Box {
            Icon(
                imageVector = Icons.Filled.MoreVert,
                contentDescription = "Conversation actions",
                modifier = Modifier
                    .size(32.dp)
                    .clickable { menuOpen = true }
                    .padding(4.dp),
            )
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                // Computer and tasks are bot ideas; a room has neither (§12).
                if (isBot) {
                    DropdownMenuItem(
                        text = { Text("Watch this computer") },
                        onClick = {
                            menuOpen = false
                            onWatchComputer()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Tasks") },
                        // A running bot refuses task changes underneath it.
                        enabled = (chat as Chat.BotChat).bot.busy != true,
                        onClick = {
                            menuOpen = false
                            onTasks()
                        },
                    )
                    HorizontalDivider()
                }
                ShareFormat.entries.forEach { format ->
                    DropdownMenuItem(
                        text = { Text(format.label) },
                        onClick = {
                            menuOpen = false
                            onShare(format)
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun Composer(
    name: String,
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    val canSend = draft.isNotBlank()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .background(secondaryTint.copy(alpha = 0.16f), CircleShape)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            if (draft.isEmpty()) {
                Text("Ask $name", fontSize = 17.sp, color = secondaryTint)
            }
            BasicTextField(
                value = draft,
                onValueChange = onDraftChange,
                maxLines = 5,
                textStyle = LocalTextStyle.current.copy(
                    fontSize = 17.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                // Software keyboards have no Shift+Return, so their Return key
                // is a send — which is what the Send action promises.
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
                modifier = Modifier
                    .fillMaxWidth()
                    // Return sends, Shift+Return breaks the line — the shape
                    // every chat app has on a hardware keyboard.
                    .onPreviewKeyEvent { event ->
                        val isReturn = event.key == Key.Enter || event.key == Key.NumPadEnter
                        if (event.type == KeyEventType.KeyDown && isReturn && !event.isShiftPressed) {
                            onSend()
                            true
                        } else {
                            false
                        }
                    },
            )
        }

        Box(
            modifier = Modifier
                .size(36.dp)
                .background(
                    if (canSend) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        secondaryTint.copy(alpha = 0.35f)
                    },
                    CircleShape,
                )
                .clickable(enabled = canSend, onClick = onSend),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.Send,
                contentDescription = "Send",
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}
