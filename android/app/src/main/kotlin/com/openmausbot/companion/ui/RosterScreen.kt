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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChatSummary
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.SearchHit
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.chatSummaries
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The roster — the port of `ios/App/ChatListView.swift`.
 *
 * Styled after the desktop's messaging-app feel rather than a settings list: big
 * mascot faces, the bot's role as a chip beside its name, a preview line, no
 * dividers. Anything waiting on you is pulled to the top, because that is the one
 * thing a phone is better at than the laptop.
 *
 * Ordering is not decided here. `chatSummaries` (`:core`) folds pinned → unread →
 * last activity and hides hidden bots; the screen renders what it is handed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RosterScreen(navigator: CompanionNavigator) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    val state by session.state.collectAsState()
    val connection by session.connection.collectAsState()

    var query by rememberSaveable { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<SearchHit>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    // Local filtering is always on; the computer is only asked past two
    // characters and after a quiet moment (§10).
    LaunchedEffect(query) {
        when (val decision = SearchPolicy.decide(query)) {
            SearchPolicy.Decision.Clear -> {
                hits = emptyList()
                searching = false
            }
            is SearchPolicy.Decision.Remote -> {
                searching = true
                delay(SearchPolicy.DEBOUNCE_MILLIS)
                hits = session.search(decision.query)
                searching = false
            }
        }
    }

    val summaries = remember(state, query) { SearchPolicy.filter(state.chatSummaries, query) }
    val approvals = remember(state) { state.pendingApprovals }

    Column(modifier = Modifier.fillMaxSize()) {
        RosterHeader(
            name = connection?.name ?: "You",
            query = query,
            onQueryChange = { query = it },
            onProfile = { navigator.push(Destination.Settings) },
            onCreateBot = {
                scope.launch {
                    session.createBot()?.let { navigator.push(Destination.Thread(it.threadId)) }
                }
            },
        )
        StatusBanner()

        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    // Session.refresh waits until the stream leaves connecting
                    // (or 10s), so the spinner means what it appears to mean.
                    session.refresh()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            if (summaries.isEmpty() && hits.isEmpty()) {
                EmptyState(
                    title = if (query.isEmpty()) "No bots yet" else "Nothing matches",
                    description = if (query.isEmpty()) {
                        "Bots you create on your computer show up here."
                    } else {
                        "No chat matches “$query”."
                    },
                )
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            ) {
                if (query.isEmpty()) {
                    items(approvals, key = { it.message.id }) { pending ->
                        val chat = ThreadResolution.chatOrNull(state, pending.threadId)
                        if (chat != null) {
                            WaitingRow(
                                chat = chat,
                                card = pending.message.card,
                                onClick = { navigator.push(Destination.Thread(chat.threadId)) },
                            )
                        }
                    }
                }

                if (query.isNotEmpty() && hits.isNotEmpty()) {
                    item(key = "search-header") {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 10.dp, bottom = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = "Messages",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = secondaryTint,
                            )
                            Spacer(Modifier.weight(1f))
                            if (searching) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(14.dp),
                                    strokeWidth = 2.dp,
                                )
                            }
                        }
                    }
                    items(hits, key = { it.id }) { hit ->
                        SearchHitRow(
                            hit = hit,
                            onClick = {
                                scope.launch {
                                    // Session.open switches task, sets the active
                                    // branch, loads the `around` page and focuses
                                    // the message — the chat screen honours the
                                    // focus when it opens.
                                    session.open(hit)?.let {
                                        navigator.push(Destination.Thread(it.threadId))
                                    }
                                }
                            },
                        )
                    }
                }

                items(summaries, key = { it.chat.threadId }) { summary ->
                    ChatRow(
                        summary = summary,
                        onClick = { navigator.push(Destination.Thread(summary.chat.threadId)) },
                    )
                }
            }
        }
    }
}

/** Who you are, and how to find a chat — both at the top, always. */
@Composable
private fun RosterHeader(
    name: String,
    query: String,
    onQueryChange: (String) -> Unit,
    onProfile: () -> Unit,
    onCreateBot: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProfileAvatar(name = name, modifier = Modifier.clickable(onClick = onProfile))

        Row(
            modifier = Modifier
                .weight(1f)
                .background(secondaryTint.copy(alpha = 0.16f), CircleShape)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Filled.Search,
                contentDescription = null,
                tint = secondaryTint,
                modifier = Modifier.size(18.dp),
            )
            Box(modifier = Modifier.weight(1f)) {
                if (query.isEmpty()) {
                    Text("Search chats", fontSize = 16.sp, color = secondaryTint)
                }
                BasicTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (query.isNotEmpty()) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Clear search",
                    tint = secondaryTint,
                    modifier = Modifier
                        .size(18.dp)
                        .clickable { onQueryChange("") },
                )
            }
        }

        // Same place the desktop puts it, top-right of the roster.
        Icon(
            imageVector = Icons.Filled.Add,
            contentDescription = "New bot",
            modifier = Modifier
                .size(34.dp)
                .clickable(onClick = onCreateBot)
                .padding(6.dp),
        )
    }
}

@Composable
private fun ChatRow(summary: ChatSummary, onClick: () -> Unit) {
    val chat = summary.chat
    val now = remember(summary.lastActivity) { System.currentTimeMillis() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        MausAvatar(color = chat.color, size = 52.dp)

        Column(verticalArrangement = Arrangement.spacedBy(5.dp), modifier = Modifier.weight(1f)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = chat.name,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                // the bot's job, the way the desktop shows it
                if (chat.subtitle.isNotEmpty()) {
                    Text(
                        text = chat.subtitle,
                        fontSize = 13.sp,
                        color = secondaryTint,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .background(secondaryTint.copy(alpha = 0.15f), CircleShape)
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
                Spacer(Modifier.weight(1f))
                Text(
                    text = RelativeStamp.list(summary.lastActivity, now, locale = Locale.getDefault()),
                    fontSize = 14.sp,
                    color = secondaryTint,
                )
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = summary.preview.ifEmpty { " " },
                    fontSize = 15.sp,
                    color = secondaryTint,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                if (chat.busy) {
                    CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
                } else if (chat.unread) {
                    Box(
                        Modifier
                            .size(9.dp)
                            .background(Color(MausPalette.argb(chat.color)), CircleShape),
                    )
                }
            }
        }
    }
}

/**
 * A bot that stopped and needs a person. The whole reason for the app, so it gets
 * to sit above the roster and look unlike everything else.
 */
@Composable
private fun WaitingRow(chat: Chat, card: OptionCard?, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f))
            .clickable(onClick = onClick)
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MausAvatar(color = chat.color, size = 38.dp)
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = "${chat.name} is waiting on you",
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = card?.subtitle.orEmpty(),
                fontSize = 14.sp,
                color = secondaryTint,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SearchHitRow(hit: SearchHit, onClick: () -> Unit) {
    val now = remember(hit.id) { System.currentTimeMillis() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(hit.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                hit.task?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, fontSize = 12.sp, color = secondaryTint)
                }
                Spacer(Modifier.weight(1f))
                Text(
                    text = RelativeStamp.list(hit.at, now, locale = Locale.getDefault()),
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
            }
            Text(
                text = hit.snippet,
                fontSize = 14.sp,
                color = secondaryTint,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Connection state, shown only when it is not "fine". */
@Composable
fun StatusBanner() {
    val session = LocalCompanion.current.session
    val status by session.status.collectAsState()
    val banner: Pair<String, Color>? = when (val current = status) {
        Session.Status.Live, Session.Status.Unpaired -> null
        Session.Status.Connecting -> "Connecting…" to secondaryTint
        is Session.Status.Offline -> current.message to Color(MausPalette.argb("orange"))
        Session.Status.Unauthorized ->
            "This phone was unpaired on the computer." to MaterialTheme.colorScheme.error
    }
    val (text, tint) = banner ?: return
    Text(
        text = text,
        fontSize = 13.sp,
        color = tint,
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .background(secondaryTint.copy(alpha = 0.12f), CircleShape)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}
