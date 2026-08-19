package com.openmausbot.companion.ui

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import com.openmausbot.companion.core.ExportedTranscript
import com.openmausbot.companion.core.Session
import java.net.URI
import com.openmausbot.companion.discovery.NsdDiscovery
import com.openmausbot.companion.permissions.CompanionPermissions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Camera access, as the scanner needs to reason about it. */
enum class CameraAccess { UNKNOWN, GRANTED, DENIED }

/**
 * Camera permission is asked for at the moment the user opens the scanner and
 * never before — the app is usable without a camera (Bonjour list, typed
 * address), so a launch-time prompt would be asking for something most sessions
 * never use.
 */
class CameraPermissionController(
    private val isGranted: () -> Boolean,
    private val request: () -> Unit,
) {
    private val _access = MutableStateFlow(if (isGranted()) CameraAccess.GRANTED else CameraAccess.UNKNOWN)
    val access: StateFlow<CameraAccess> = _access.asStateFlow()

    /** Ask once; the OS shows the sheet only while the answer is still unknown. */
    fun ensure() {
        if (isGranted()) {
            _access.value = CameraAccess.GRANTED
            return
        }
        request()
    }

    fun onResult(granted: Boolean) {
        _access.value = if (granted) CameraAccess.GRANTED else CameraAccess.DENIED
    }

    /** Recover immediately when the user returns from Settings having granted it. */
    fun refresh() {
        if (isGranted()) _access.value = CameraAccess.GRANTED
    }
}

/**
 * The SwiftUI `@EnvironmentObject` analogue: the long-lived objects every screen
 * reaches for, provided once at the top of the composition.
 */
@Immutable
class CompanionEnvironment(
    val session: Session,
    val permissions: CompanionPermissions,
    val discovery: NsdDiscovery,
    val camera: CameraPermissionController,
    val notifications: NotificationPermissionController,
    /** Fires the activity's `RequestMultiplePermissions` launcher. */
    val requestPermissions: (Array<String>) -> Unit,
    /** Opens the OS app-settings page, for a permission the user denied. */
    val openAppSettings: () -> Unit,
    /** Hands an exported transcript to the share sheet; null on success. */
    val shareTranscript: (ExportedTranscript, ShareFormat) -> String?,
    /** Opens a freshly minted cloud-desktop URL in Custom Tabs; null on success. */
    val openCloudDesktop: (URI) -> String?,
)

val LocalCompanion = staticCompositionLocalOf<CompanionEnvironment> {
    error("CompanionEnvironment was not provided")
}
