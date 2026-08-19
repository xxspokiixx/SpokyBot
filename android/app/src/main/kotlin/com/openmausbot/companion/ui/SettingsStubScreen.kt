package com.openmausbot.companion.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Session

/**
 * The Settings destination, as a placeholder.
 *
 * The real screen — edit address, notification permission, unpair — is pass 4
 * (`ios/App/SettingsView.swift`). This exists so the roster's profile button
 * leads somewhere honest instead of nowhere.
 */
@Composable
fun SettingsStubScreen(onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val connection by environment.session.connection.collectAsState()
    val status by environment.session.status.collectAsState()
    val permissions by environment.permissions.snapshot.collectAsState()

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
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
            Text("Settings", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        HorizontalDivider()

        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SettingsRow("Computer", connection?.name ?: "—")
            SettingsRow(
                "Address",
                connection?.let { "${it.host}:${it.port}" } ?: "—",
            )
            SettingsRow("Connection", statusLabel(status))
            SettingsRow(
                "Notifications",
                if (permissions.notificationsGranted) "Allowed" else "Not allowed",
            )
            Text(
                text = "Editing the address, notification settings and unpairing arrive with the " +
                    "next release. Companion pairings are managed on the computer — losing the " +
                    "phone must not lose the ability to lock it out.",
                fontSize = 13.sp,
                color = secondaryTint,
            )
        }
    }
}

@Composable
private fun SettingsRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, fontSize = 15.sp, color = secondaryTint)
        Text(
            text = value,
            fontSize = 15.sp,
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
    }
}

private fun statusLabel(status: Session.Status): String = when (status) {
    Session.Status.Unpaired -> "Not paired"
    Session.Status.Connecting -> "Connecting…"
    Session.Status.Live -> "Connected"
    Session.Status.Unauthorized -> "Unpaired on the computer"
    is Session.Status.Offline -> status.message
}
