package com.openmausbot.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import com.openmausbot.companion.notifications.LocalNotificationPoster
import com.openmausbot.companion.ui.CameraPermissionController
import com.openmausbot.companion.ui.CompanionEnvironment
import com.openmausbot.companion.ui.CompanionRoot
import com.openmausbot.companion.ui.LocalCompanion
import com.openmausbot.companion.ui.PendingThreadNavigation

/**
 * The single Activity. It owns the permission launchers and the two things that
 * arrive as Intents — a pairing deep link and a notification tap — and hands the
 * rest to Compose.
 *
 * Connect/disconnect is not here: `OpenMausApp` drives it from
 * `ProcessLifecycleOwner`, which is the Android shape of iOS's `scenePhase`.
 */
class MainActivity : ComponentActivity() {
    private val app: OpenMausApp
        get() = application as OpenMausApp

    /** Notification tap → the thread it is about; delivered to the UI once. */
    private lateinit var notificationNavigation: PendingThreadNavigation

    private lateinit var camera: CameraPermissionController

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        app.permissions.onRequestResult(results)
    }

    private val cameraLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        camera.onResult(granted)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        notificationNavigation = PendingThreadNavigation(
            savedInstanceState?.getString(STATE_CONSUMED_THREAD_ID),
        )

        camera = CameraPermissionController(
            isGranted = {
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED
            },
            request = { cameraLauncher.launch(Manifest.permission.CAMERA) },
        )

        val environment = CompanionEnvironment(
            session = app.session,
            permissions = app.permissions,
            discovery = app.discovery,
            camera = camera,
            requestPermissions = { permissions -> permissionLauncher.launch(permissions) },
            openAppSettings = ::openAppSettings,
        )

        handleIntent(intent)

        setContent {
            val threadId by notificationNavigation.pending.collectAsState()
            CompositionLocalProvider(LocalCompanion provides environment) {
                CompanionRoot(
                    pendingThreadId = threadId,
                    onPendingThreadConsumed = notificationNavigation::consume,
                )
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_CONSUMED_THREAD_ID, notificationNavigation.consumedThreadId())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // A tap that arrives while the app is already up is always a new request,
        // even for a thread that was opened from a notification before.
        handleIntent(intent, fresh = true)
    }

    override fun onResume() {
        super.onResume()
        // Permissions can change while the app is in the background — a grant
        // made in Settings should take effect on return, not on next launch.
        app.permissions.refresh()
        camera.refresh()
    }

    /**
     * Deliberately reads only the notification extra.
     *
     * Pairing deep links belong to [PairingLinkActivity] and never reach here:
     * this Activity is the root of the main task, so the system keeps and may
     * persist its launching Intent, and a one-time credential must not live
     * anywhere the process does not. Ignoring `intent.data` outright also means
     * another app cannot hand this exported Activity a crafted pairing URL.
     */
    private fun handleIntent(intent: Intent?, fresh: Boolean = false) {
        if (intent == null) return

        // The extra deliberately stays on the Intent: PendingThreadNavigation
        // remembers what has already been opened, so a rotation before the
        // composition consumed it still navigates, and one after it does not.
        notificationNavigation.offer(
            intent.getStringExtra(LocalNotificationPoster.EXTRA_THREAD_ID),
            fresh = fresh,
        )
    }

    private fun openAppSettings() {
        startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            },
        )
    }

    private companion object {
        const val STATE_CONSUMED_THREAD_ID = "openmaus.consumedThreadId"
    }
}
