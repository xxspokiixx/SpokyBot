package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.PairingInvite
import com.openmausbot.companion.discovery.DiscoveredService
import com.openmausbot.companion.discovery.DiscoveryState
import com.openmausbot.companion.discovery.toConnection
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Pairing: scan the computer's QR, confirm its identity, and connect — the port
 * of `ios/App/PairingView.swift`.
 *
 * Three ways in, because discovery is allowed to fail. NSD finds the computer by
 * name when the network cooperates; when it does not — a guest network with
 * multicast off, a responder that could not take port 5353 — the address the
 * desktop panel prints is typed instead.
 *
 * A scan never pairs by itself. A scanned or deep-linked invite fills the form
 * and the user confirms the computer's name and address before anything is
 * redeemed (§6).
 */
@Composable
fun PairingScreen() {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    // `PairingView.swift` fires `Haptics.selection()` on every one of these:
    // scanning, picking a discovered computer, taking a typed address, both
    // submits, and going back to the list.
    val haptics = rememberHaptics()

    val secrets = PairingSecrets

    var manualAddress by rememberSaveable { mutableStateOf("") }
    // Saved instance state holds the computer and a handle, never a secret. A
    // rotation keeps the same process, so PairingSecrets still has the scanned
    // credential and the typed digits; a restore after the system killed the app
    // gets an empty store, and the confirm step asks for a rescan rather than
    // replaying a token that may already have been redeemed (§6).
    var pending by rememberSaveable(stateSaver = PendingPairingSaver) {
        mutableStateOf<PendingPairing?>(null)
    }
    // A pending pairing restored after a process restart carries a handle this
    // store never minted, so writes to it would go nowhere and the next rotation
    // would find the code field empty again. Give a typed pairing a fresh slot
    // before it accepts input; a scanned one stays orphaned, which is the rescan
    // case.
    LaunchedEffect(pending?.handle) {
        val current = pending ?: return@LaunchedEffect
        val rebound = current.rebindingIfOrphaned(secrets)
        if (rebound !== current) pending = rebound
    }
    // Read back out of the process-scoped store, so a rotation does not lose the
    // digits and a process restart does.
    var code by remember(pending?.handle) { mutableStateOf(secrets.code(pending?.handle)) }
    var pairing by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var showingScanner by remember { mutableStateOf(false) }
    // "Looking…" forever is not an answer. After a few seconds with nothing
    // found, say the thing that is almost always true.
    var searchedLongEnough by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        delay(8_000)
        searchedLongEnough = true
    }

    // The request itself is fired once from CompanionRoot, which also covers an
    // already-paired install that never sees this screen. What belongs here is
    // saying what a refusal costs, next to the list it makes empty.
    val permissionSnapshot by environment.permissions.snapshot.collectAsState()

    val invite by session.pairingInvite.collectAsState()
    LaunchedEffect(invite) {
        val accepted = invite ?: return@LaunchedEffect
        // The credential goes to the process-scoped store; only the handle is
        // ever held by composition state.
        pending = PendingPairing(
            connection = accepted.connection,
            fromScan = true,
            handle = secrets.open(accepted.credential),
        )
        code = ""
        failure = null
        session.consumePairingInvite()
    }

    // Session raises pairing problems through actionError; on this screen they
    // belong next to the form rather than in a modal on top of it.
    val actionError by session.actionErrorFlow.collectAsState()
    LaunchedEffect(actionError) {
        val message = actionError ?: return@LaunchedEffect
        failure = message
        session.actionError = null
    }

    val discoveryFlow = remember { environment.discovery.discover() }
    val discovery by discoveryFlow.collectAsState(initial = DiscoveryState.Idle)

    if (showingScanner) {
        QrScannerScreen(
            onCancel = { showingScanner = false },
            validate = { payload ->
                if (PairingInvite.parse(payload) == null) {
                    "That isn't an OpenMausBot pairing QR code."
                } else {
                    // Session decides whether this invite may be accepted at all
                    // (already paired, credential already burned) and publishes
                    // it as `pairingInvite` for the confirm step above.
                    session.receivePairingURL(payload)
                    showingScanner = false
                    null
                }
            },
        )
        return
    }

    fun submit(connection: Connection, credential: String, cameFromScanner: Boolean) {
        pairing = true
        failure = null
        scope.launch {
            try {
                session.pair(connection, credential)
            } catch (error: Throwable) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                // Session already appended "Start pairing again … rescan the new
                // QR code." for a one-time credential; a burned token must never
                // be replayed, so the form goes back to choosing a computer.
                failure = session.actionError ?: error.message ?: "Pairing failed."
                session.actionError = null
                if (cameFromScanner) {
                    pending = null
                    secrets.clear()
                } else {
                    code = ""
                    secrets.setCode(pending?.handle, "")
                }
            } finally {
                pairing = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Text(
            text = "Pair with a computer",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )

        val selected = pending
        if (selected != null) {
            CodeSection(
                confirmation = PairingConfirmation.of(selected, secrets),
                code = code,
                onCodeChange = { value ->
                    val digits = value.filter { it in '0'..'9' }.take(6)
                    code = digits
                    secrets.setCode(selected.handle, digits)
                },
                pairing = pairing,
                onSubmit = { credential ->
                    haptics.play(HapticCue.SELECT)
                    submit(selected.connection, credential, selected.fromScan)
                },
                onCancel = {
                    haptics.play(HapticCue.SELECT)
                    pending = null
                    code = ""
                    secrets.clear()
                    failure = null
                },
            )
        } else {
            SetupSection(onScan = {
                haptics.play(HapticCue.SELECT)
                failure = null
                showingScanner = true
            })
            DiscoverySection(
                discovery = discovery,
                searchedLongEnough = searchedLongEnough,
                onChoose = { service ->
                    haptics.play(HapticCue.SELECT)
                    failure = null
                    val connection = service.toConnection()
                    if (connection == null) {
                        failure = "That computer did not answer with an address. " +
                            "Enter the address shown by Companion instead."
                    } else {
                        pending = PendingPairing(
                            connection = connection,
                            fromScan = false,
                            handle = secrets.open(),
                        )
                    }
                },
            )
            ManualSection(
                address = manualAddress,
                onAddressChange = { manualAddress = it },
                onContinue = {
                    haptics.play(HapticCue.SELECT)
                    failure = null
                    val connection = Connection.parse(manualAddress)
                    if (connection == null) {
                        failure = "That should look like 192.168.1.42:8810."
                    } else {
                        pending = PendingPairing(
                            connection = connection,
                            fromScan = false,
                            handle = secrets.open(),
                        )
                    }
                },
            )
        }

        failure?.let {
            Text(text = it, color = MaterialTheme.colorScheme.error, fontSize = 14.sp)
        }

        if (permissionSnapshot.needsRequest) {
            Text(
                text = "Some permissions are still off: ${permissionSnapshot.missing.joinToString()}. " +
                    "Notifications carry approvals, and nearby-devices is what lets this phone see " +
                    "your computer on the network.",
                fontSize = 13.sp,
                color = secondaryTint,
            )
        }
    }
}

@Composable
private fun SetupSection(onScan: () -> Unit) {
    SectionCard(title = "On your computer") {
        Text("1.  Open OpenMausBot → Settings → Companion", fontSize = 15.sp)
        Text("2.  Choose Set up a phone", fontSize = 15.sp)
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) {
            Text("Scan QR Code")
        }
        Text(
            text = "Scan the QR code, check the computer name, and confirm. The address and " +
                "one-time credential are filled securely for you.",
            fontSize = 13.sp,
            color = secondaryTint,
        )
    }
}

@Composable
private fun DiscoverySection(
    discovery: DiscoveryState,
    searchedLongEnough: Boolean,
    onChoose: (DiscoveredService) -> Unit,
) {
    val active = discovery as? DiscoveryState.Active
    SectionCard(title = "On this network") {
        val problem = active?.failure
        when {
            problem != null -> Text(problem, fontSize = 13.sp, color = secondaryTint)

            active == null || active.found.isEmpty() -> {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text("Looking…", color = secondaryTint, fontSize = 15.sp)
                }
                if (searchedLongEnough) {
                    // NSD is multicast: it does not cross subnets, and guest
                    // networks usually block it between clients even within one.
                    // Different Wi-Fi on the two devices is by far the most
                    // common reason this list stays empty.
                    Text(
                        text = "Nothing found yet. Check that this phone and your computer are on " +
                            "the same Wi-Fi network — a guest network often blocks them from seeing " +
                            "each other. You can always enter the address below instead.",
                        fontSize = 13.sp,
                        color = secondaryTint,
                    )
                    // The honest answer when a network refuses to cooperate.
                    Text(
                        text = "If it never appears, install Tailscale on both and sign in to the " +
                            "same account — the Companion panel will then show a name ending in " +
                            ".ts.net to enter below.",
                        fontSize = 13.sp,
                        color = secondaryTint,
                    )
                }
            }

            else -> Unit
        }

        active?.found?.forEach { service ->
            TextButton(
                onClick = { onChoose(service) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(service.name, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Start)
            }
        }
    }
}

@Composable
private fun ManualSection(
    address: String,
    onAddressChange: (String) -> Unit,
    onContinue: () -> Unit,
) {
    SectionCard(title = "Or enter the address") {
        OutlinedTextField(
            value = address,
            onValueChange = onAddressChange,
            placeholder = { Text("192.168.1.42:8810") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = onContinue,
            enabled = address.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Continue")
        }
        Text(
            text = "Whatever the Companion panel shows — an address on this network, or a " +
                "Tailscale name like macbook.tail1234.ts.net:8810, which works from anywhere.",
            fontSize = 13.sp,
            color = secondaryTint,
        )
    }
}

@Composable
private fun CodeSection(
    confirmation: PairingConfirmation,
    code: String,
    onCodeChange: (String) -> Unit,
    pairing: Boolean,
    onSubmit: (String) -> Unit,
    onCancel: () -> Unit,
) {
    SectionCard(title = "Confirm computer") {
        // Name and address sit above the branch, as they do in `PairingView.swift`:
        // the user is confirming which computer at which address, and that is the
        // same question whether the credential came from a QR code or the six
        // digits are about to be typed.
        Text(confirmation.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        Row(modifier = Modifier.fillMaxWidth()) {
            Text("Address", color = secondaryTint, fontSize = 15.sp)
            Spacer(Modifier.weight(1f))
            Text(confirmation.address, fontSize = 15.sp, fontFamily = FontFamily.Monospace)
        }
        Text(confirmation.notice, fontSize = 13.sp, color = secondaryTint)

        when (val step = confirmation.step) {
            is PairingConfirmation.Step.Confirm -> Button(
                onClick = { onSubmit(step.credential) },
                enabled = !pairing,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (pairing) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("Pair with this computer")
                }
            }

            PairingConfirmation.Step.EnterCode -> {
                OutlinedTextField(
                    value = code,
                    onValueChange = onCodeChange,
                    placeholder = { Text("000000") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    textStyle = MaterialTheme.typography.headlineSmall.copy(
                        fontFamily = FontFamily.Monospace,
                        textAlign = TextAlign.Center,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { onSubmit(code) },
                    enabled = code.length == 6 && !pairing,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (pairing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Connect")
                    }
                }
            }

            // The app was restarted between the scan and the confirmation. The
            // token may already have reached the computer, and §6 is absolute
            // about never sending one twice, so there is nothing to retry here —
            // only the computer's name and address, and the way back.
            PairingConfirmation.Step.Rescan -> Unit
        }

        OutlinedButton(onClick = onCancel, enabled = !pairing, modifier = Modifier.fillMaxWidth()) {
            Text("Choose a different computer")
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            text = title.uppercase(),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color = secondaryTint,
        )
        HorizontalDivider()
        Spacer(Modifier.height(2.dp))
        content()
    }
}
