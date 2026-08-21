package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R

/**
 * What little the phone gets to configure — the port of
 * `ios/App/SettingsView.swift`.
 *
 * Almost nothing, on purpose: companion settings, API keys and pairing all live
 * on the computer, because losing the phone must not mean losing the ability to
 * lock it out (§13). This is a status page with an unpair button.
 */
@Composable
fun SettingsScreen(onBack: () -> Unit, onOpenRoutines: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val connection by session.connection.collectAsState()
    val status by session.status.collectAsState()
    val notifications by environment.notifications.access.collectAsState()

    var editingAddress by remember { mutableStateOf(false) }
    var addressText by remember { mutableStateOf("") }
    var addressError by remember { mutableStateOf<String?>(null) }
    var confirmingUnpair by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text("Settings", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        HorizontalDivider()

        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            SettingsSection("Computer") {
                connection?.let {
                    SettingsRow("Name", it.name)
                    SettingsRow("Address", SettingsPolicy.addressText(it))
                    // The stored address can simply go stale. Editing it here
                    // keeps the pairing and its token (§7).
                    SettingsButton("Edit address") {
                        addressText = SettingsPolicy.addressText(it)
                        addressError = null
                        editingAddress = true
                    }
                }
                SettingsRow("Connection", SettingsPolicy.statusText(status))
            }

            SettingsSection("Notifications") {
                SettingsRow(
                    "Status",
                    NotificationPermissionController.statusText(notifications),
                )
                SettingsButton(
                    text = NotificationPermissionController.buttonText(notifications),
                    enabled = NotificationPermissionController.buttonEnabled(notifications),
                    onClick = environment.notifications::act,
                )
                Footnote(SettingsPolicy.NOTIFICATIONS_FOOTER)
            }

            SettingsSection("Workspace") {
                SettingsButton(
                    text = "Tasks & Routines",
                    icon = R.drawable.ic_schedule,
                    onClick = onOpenRoutines,
                )
                Footnote(SettingsPolicy.WORKSPACE_FOOTER)
            }

            SettingsSection(null) {
                SettingsButton(
                    text = "Unpair this phone",
                    destructive = true,
                ) { confirmingUnpair = true }
                Footnote(SettingsPolicy.UNPAIR_FOOTER)
            }

            SettingsSection("Not here") {
                Footnote(SettingsPolicy.NOT_HERE)
            }
        }
    }

    if (editingAddress) {
        AlertDialog(
            onDismissRequest = { editingAddress = false },
            title = { Text("Edit address") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(SettingsPolicy.EDIT_ADDRESS_MESSAGE, fontSize = 14.sp)
                    OutlinedTextField(
                        value = addressText,
                        onValueChange = {
                            addressText = it
                            addressError = null
                        },
                        placeholder = { Text("192.168.1.42:8810") },
                        singleLine = true,
                        isError = addressError != null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    addressError?.let {
                        Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        // Session re-parses, re-dials and persists; the walk and
                        // promote semantics stay its job. The form only refuses
                        // what it can already tell is not an address.
                        if (session.updateAddress(addressText)) {
                            editingAddress = false
                        } else {
                            addressError = AddressEdit.INVALID
                        }
                    },
                ) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { editingAddress = false }) { Text("Cancel") }
            },
        )
    }

    if (confirmingUnpair) {
        AlertDialog(
            onDismissRequest = { confirmingUnpair = false },
            title = { Text(SettingsPolicy.UNPAIR_CONFIRM_TITLE) },
            text = { Text(SettingsPolicy.UNPAIR_CONFIRM_MESSAGE) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmingUnpair = false
                        // Local token and connection only. Revoking the device
                        // itself is Settings → Companion on the computer (§6).
                        session.signOut()
                    },
                ) {
                    Text("Unpair", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingUnpair = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun SettingsSection(title: String?, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        title?.let {
            Text(
                text = it.uppercase(),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = secondaryTint,
            )
        }
        HorizontalDivider()
        content()
    }
}

@Composable
private fun SettingsRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, fontSize = 15.sp, color = secondaryTint)
        Text(
            text = value,
            fontSize = 15.sp,
            textAlign = TextAlign.End,
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp),
        )
    }
}

@Composable
private fun SettingsButton(
    text: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    icon: Int? = null,
    onClick: () -> Unit,
) {
    val tint = if (destructive) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.primary
    }
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = MIN_TOUCH_TARGET),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon?.let {
                Icon(
                    painter = painterResource(it),
                    contentDescription = null,
                    tint = tint,
                    modifier = Modifier.size(20.dp),
                )
            }
            Text(
                text = text,
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Start,
                color = tint,
            )
        }
    }
}

@Composable
private fun Footnote(text: String) {
    Text(text = text, fontSize = 13.sp, color = secondaryTint)
}
