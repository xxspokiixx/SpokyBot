package com.openmausbot.companion

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.notifications.LocalNotificationPoster

/**
 * Stub status Activity — proves the Compose toolchain and the permission
 * request surface. Real screens are a later pass.
 */
class MainActivity : ComponentActivity() {
    private val app: OpenMausApp
        get() = application as OpenMausApp

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        app.permissions.onRequestResult(results)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Minimal exercise of the permission contract so the platform layer
        // is provable before the UI pass wires Settings / onboarding prompts.
        val missing = app.permissions.requestablePermissions()
        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing)
        }
        handlePairIntent(intent)
        setContent {
            val status by app.session.status.collectAsState()
            val connection by app.session.connection.collectAsState()
            val permissions by app.permissions.snapshot.collectAsState()
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(24.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = "OpenMausMobile",
                            style = MaterialTheme.typography.headlineMedium,
                        )
                        Text(
                            text = statusLabel(status),
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                        connection?.let {
                            Text(
                                text = "${it.name} · ${it.host}:${it.port}",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                        Text(
                            text = permissionLabel(permissions.missing),
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 16.dp),
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePairIntent(intent)
    }

    private fun handlePairIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "openmausbot" && data.host == "pair") {
            app.session.receivePairingURL(data.toString())
        }
        intent?.getStringExtra(LocalNotificationPoster.EXTRA_THREAD_ID)?.let {
            // Later pass: navigate to thread. Hook reserved here.
        }
    }

    private fun statusLabel(status: Session.Status): String = when (status) {
        Session.Status.Unpaired -> "Status: unpaired"
        Session.Status.Connecting -> "Status: connecting"
        Session.Status.Live -> "Status: live"
        Session.Status.Unauthorized -> "Status: unauthorized"
        is Session.Status.Offline -> "Status: offline — ${status.message}"
    }

    private fun permissionLabel(missing: List<String>): String =
        if (missing.isEmpty()) {
            "Permissions: granted"
        } else {
            "Permissions missing: ${missing.joinToString()}"
        }
}
