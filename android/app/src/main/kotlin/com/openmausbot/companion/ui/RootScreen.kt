package com.openmausbot.companion.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.Session

/**
 * Which of the three worlds the app is in — the port of `RootView` in
 * `ios/App/CompanionApp.swift`.
 */
@Composable
fun CompanionRoot(
    pendingThreadId: String?,
    onPendingThreadConsumed: () -> Unit,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val status by session.status.collectAsState()

    // What the app needs to do its job: notifications, because approvals are the
    // reason it exists, and nearby/local-network per SDK, because without them
    // NSD browses and silently finds nothing. Asked once, at the first screen —
    // pairing for a new phone, the roster for one that is already paired.
    LaunchedEffect(Unit) {
        val missing = environment.permissions.requestablePermissions()
        if (missing.isNotEmpty()) environment.requestPermissions(missing)
    }

    CompanionTheme {
        // One place for system insets: the app draws edge to edge, and every
        // screen wants the same answer — keep content clear of the status bar,
        // the gesture bar, and the keyboard.
        Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
            when (status) {
                is Session.Status.Unpaired -> PairingScreen()
                is Session.Status.Unauthorized -> UnpairedScreen()
                else -> PairedScreen(pendingThreadId, onPendingThreadConsumed)
            }
        }
        // Pairing failures are shown inline on the pairing form, where the
        // action was — a modal on top of it would say the same thing twice.
        if (status !is Session.Status.Unpaired) {
            ActionErrorDialog(session)
        }
    }
}

@Composable
private fun PairedScreen(pendingThreadId: String?, onPendingThreadConsumed: () -> Unit) {
    val navigator = rememberCompanionNavigator()

    // Notification tap → the thread it is about. The one quality delta over iOS,
    // which only presents the banner (§16).
    LaunchedEffect(pendingThreadId) {
        val threadId = pendingThreadId ?: return@LaunchedEffect
        navigator.openThread(threadId)
        onPendingThreadConsumed()
    }

    BackHandler(enabled = navigator.canGoBack) { navigator.pop() }

    when (val destination = navigator.current) {
        Destination.Roster -> RosterScreen(navigator)
        Destination.Settings -> SettingsStubScreen(onBack = navigator::pop)
        is Destination.Thread -> ChatScreen(
            threadId = destination.threadId,
            onBack = navigator::pop,
        )
    }
}

@Composable
private fun ActionErrorDialog(session: Session) {
    val message by session.actionErrorFlow.collectAsState()
    val text = message ?: return
    AlertDialog(
        onDismissRequest = { session.actionError = null },
        title = { Text("Something went wrong") },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = { session.actionError = null }) { Text("OK") }
        },
    )
}

/**
 * The token stopped working. Almost always because someone revoked this phone on
 * the computer — which is exactly what that button is for, so the honest thing is
 * to say so and offer to pair again.
 */
@Composable
private fun UnpairedScreen() {
    val session = LocalCompanion.current.session
    EmptyState(
        title = "This phone was unpaired",
        description = "It was removed from the computer's companion settings, or the pairing was reset.",
    ) {
        Button(onClick = { session.signOut() }) { Text("Pair again") }
    }
}

/** SwiftUI's `ContentUnavailableView`, near enough. */
@Composable
fun EmptyState(
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    actions: @Composable () -> Unit = {},
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            text = description,
            style = MaterialTheme.typography.bodyMedium,
            color = secondaryTint,
            textAlign = TextAlign.Center,
        )
        actions()
    }
}
