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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.NotificationTarget
import com.openmausbot.companion.core.Session

/**
 * Which of the three worlds the app is in — the port of `RootView` in
 * `ios/App/CompanionApp.swift`.
 */
@Composable
fun CompanionRoot(
    pendingNotification: NotificationTarget?,
    onPendingTargetConsumed: (NotificationTarget) -> Unit,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val status by session.status.collectAsState()
    val restoreState by session.restoreState.collectAsState()

    // What the app needs to do its job: notifications, because approvals are the
    // reason it exists, and nearby/local-network per SDK, because without them
    // NSD browses and silently finds nothing. Asked once, at the first screen —
    // pairing for a new phone, the roster for one that is already paired.
    LaunchedEffect(Unit) {
        val missing = environment.permissions.requestablePermissions()
        if (missing.isNotEmpty()) environment.requestPermissions(missing)
    }

    // Resolve above PairingScreen / UnpairedScreen / PairedScreen so a tap
    // while unpaired or unauthorized is consumed (and cannot open against the
    // next bond). Re-runs when restoreState leaves Pending so a deferred
    // target is not stranded after a cold-start restore that finishes unpaired.
    // The coordinator owns every consume: identified no-chat inside onPending,
    // and navigate→consume inside commit. RootScreen cannot omit or invert.
    val tapCoordinator = remember { NotificationTapCoordinator() }
    val resolution by tapCoordinator.resolution.collectAsState()
    // Persistable: bumping this keys the navigator saver with a generation that
    // is also written into the saved value, so a stack captured while
    // Unauthorized/Unpaired was landing cannot restore after the next pair (§6).
    var bondGeneration by rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(status) {
        if (NotificationTapCoordinator.leavesBond(status)) {
            tapCoordinator.discardResolved()
            bondGeneration += 1
        }
    }
    LaunchedEffect(pendingNotification, status, restoreState) {
        val target = pendingNotification ?: return@LaunchedEffect
        tapCoordinator.onPending(session, target, onPendingTargetConsumed)
    }

    CompanionTheme {
        // One place for system insets: the app draws edge to edge, and every
        // screen wants the same answer — keep content clear of the status bar,
        // the gesture bar, and the keyboard.
        Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
            when (status) {
                is Session.Status.Unpaired -> PairingScreen()
                is Session.Status.Unauthorized -> UnpairedScreen()
                else -> PairedScreen(
                    resolution = resolution,
                    bondGeneration = bondGeneration,
                    onCommit = { held, navigator ->
                        tapCoordinator.commit(held, navigator, onPendingTargetConsumed)
                    },
                )
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
private fun PairedScreen(
    resolution: NotificationTapCoordinator.Resolution?,
    bondGeneration: Int,
    onCommit: (NotificationTapCoordinator.Resolution, CompanionNavigator) -> Unit,
) {
    val navigator = rememberCompanionNavigator(bondGeneration)

    // Session already resolved the exact task; the coordinator records the
    // stack and consumes in one commit — keyed on generation so a superseded
    // tap cannot run against a newer pending target.
    LaunchedEffect(resolution?.generation) {
        val held = resolution ?: return@LaunchedEffect
        onCommit(held, navigator)
    }

    BackHandler(enabled = navigator.canGoBack) { navigator.pop() }

    when (val destination = navigator.current) {
        Destination.Roster -> RosterScreen(navigator)
        Destination.Settings -> SettingsScreen(onBack = navigator::pop)
        // One branch for both shapes of chat address, so a notification's thread
        // becoming an addressed chat re-reads the same screen instead of
        // rebuilding it.
        is Destination.Conversation -> ChatScreen(
            destination = destination,
            onResolved = { target ->
                (destination as? Destination.Thread)?.let {
                    navigator.resolveThread(it.threadId, target)
                }
            },
            onBack = navigator::pop,
            onOpenComputer = { navigator.push(Destination.Computer(it)) },
        )
        is Destination.Computer -> ComputerScreen(
            botId = destination.botId,
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
