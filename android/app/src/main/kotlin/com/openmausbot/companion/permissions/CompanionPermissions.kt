package com.openmausbot.companion.permissions

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Platform permission surface, split by the moment each permission is earned.
 *
 * There is deliberately **no call that returns everything missing**. There used
 * to be, and the root fired it on the first frame: someone opening the app for
 * the first time met a system dialog for notifications and another for nearby
 * devices before the app had said what it was. Refusing both is the reasonable
 * answer to a question with no context, and refusing notifications costs every
 * approval alert until the person finds the switch in Settings.
 *
 * So the batch is gone rather than merely unused, and what is left says when:
 * [notificationPermissions] is for the explained step that follows a first
 * successful pairing, and [discoveryPermissions] is for the moment someone opens
 * the list of computers on this network. A screen that wanted both at once would
 * have to write the union by hand.
 */
class CompanionPermissions(
    private val sdkInt: Int = Build.VERSION.SDK_INT,
    private val granted: (String) -> Boolean,
) {
    constructor(
        context: Context,
        sdkInt: Int = Build.VERSION.SDK_INT,
    ) : this(
        sdkInt = sdkInt,
        granted = { permission ->
            ContextCompat.checkSelfPermission(context.applicationContext, permission) ==
                PackageManager.PERMISSION_GRANTED
        },
    )

    data class Snapshot(
        val notificationsGranted: Boolean,
        val localNetworkGranted: Boolean,
        val nearbyWifiGranted: Boolean,
        /** Microphone for composer dictation — never asked at startup. */
        val recordAudioGranted: Boolean,
        /**
         * The notification permission, when this device has one and has not
         * granted it. Earned by a first successful pairing, not by launching.
         */
        val missingNotifications: List<String>,
        /**
         * What a local browse needs and does not have. Earned by opening the
         * list of computers on this network.
         */
        val missingDiscovery: List<String>,
    ) {
        val discoveryNeedsRequest: Boolean get() = missingDiscovery.isNotEmpty()
    }

    private val _snapshot = MutableStateFlow(read())
    val snapshot: StateFlow<Snapshot> = _snapshot.asStateFlow()

    fun refresh(): Snapshot {
        val next = read()
        _snapshot.value = next
        return next
    }

    /**
     * What the explained notification step may ask for — that step and nothing
     * else. Empty below API 33, where there is no runtime permission at all.
     */
    fun notificationPermissions(): Array<String> = refresh().missingNotifications.toTypedArray()

    /**
     * What a local browse needs. Called when someone opens the list of nearby
     * computers, never on the way to the QR scanner, which needs none of it.
     */
    fun discoveryPermissions(): Array<String> = refresh().missingDiscovery.toTypedArray()

    /** Apply launcher results, then refresh observable state. */
    fun onRequestResult(results: Map<String, Boolean>): Snapshot {
        // Results are authoritative for the keys we asked about; re-query all.
        return refresh()
    }

    fun notificationsGranted(): Boolean = refresh().notificationsGranted

    fun localNetworkGranted(): Boolean = refresh().localNetworkGranted

    /** Composer mic — checked at the button, never at cold start. */
    fun recordAudioGranted(): Boolean = refresh().recordAudioGranted

    private fun read(): Snapshot {
        val notifications = if (sdkInt >= 33) {
            granted(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            true
        }
        val nearby = if (sdkInt >= 33) {
            granted(Manifest.permission.NEARBY_WIFI_DEVICES)
        } else {
            true
        }
        val localNetwork = if (sdkInt >= LOCAL_NETWORK_SDK) {
            granted(PERMISSION_ACCESS_LOCAL_NETWORK)
        } else {
            true
        }
        val recordAudio = granted(Manifest.permission.RECORD_AUDIO)
        // Two lists, never one. RECORD_AUDIO is in neither: it is asked from the
        // composer mic button through [requestableRecordAudio].
        val missingNotifications = buildList {
            if (sdkInt >= 33 && !notifications) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missingDiscovery = buildList {
            if (sdkInt >= 33 && !nearby) add(Manifest.permission.NEARBY_WIFI_DEVICES)
            if (sdkInt >= LOCAL_NETWORK_SDK && !localNetwork) add(PERMISSION_ACCESS_LOCAL_NETWORK)
        }
        return Snapshot(
            notificationsGranted = notifications,
            localNetworkGranted = localNetwork,
            nearbyWifiGranted = nearby,
            recordAudioGranted = recordAudio,
            missingNotifications = missingNotifications,
            missingDiscovery = missingDiscovery,
        )
    }

    companion object {
        /** Android 17 / API 37 — local-network runtime permission. */
        const val LOCAL_NETWORK_SDK = 37

        /**
         * Literal keeps compiling against older stub jars in unit tests while
         * still matching `Manifest.permission.ACCESS_LOCAL_NETWORK` on device.
         */
        const val PERMISSION_ACCESS_LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

        /** Literal for JVM unit tests that lack a full android.jar Manifest. */
        const val PERMISSION_RECORD_AUDIO = "android.permission.RECORD_AUDIO"

        /**
         * Permissions the app declares and may need to request at runtime.
         *
         * Includes [PERMISSION_RECORD_AUDIO] so the asked-flag chokepoint and
         * the manifest stay honest about it. This list is the manifest's shape,
         * not a request: nothing asks for all of it at once.
         */
        fun declaredRuntimePermissions(sdkInt: Int = Build.VERSION.SDK_INT): List<String> =
            buildList {
                if (sdkInt >= 33) {
                    add(Manifest.permission.POST_NOTIFICATIONS)
                    add(Manifest.permission.NEARBY_WIFI_DEVICES)
                }
                if (sdkInt >= LOCAL_NETWORK_SDK) {
                    add(PERMISSION_ACCESS_LOCAL_NETWORK)
                }
                add(Manifest.permission.RECORD_AUDIO)
            }

        /**
         * Single-permission request for the composer mic. Returns null when
         * already granted so callers do not open a no-op sheet.
         */
        fun requestableRecordAudio(granted: Boolean): String? =
            if (granted) null else Manifest.permission.RECORD_AUDIO
    }
}
