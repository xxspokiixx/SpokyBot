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
 * Platform permission surface for the UI pass.
 *
 * Exposes which companion permissions are missing and the exact string array to
 * feed `ActivityResultContracts.RequestMultiplePermissions`. The stub activity
 * wires the launcher; real screens decide *when* to call [requestablePermissions].
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
        /** Permissions that are relevant on this device and not yet granted. */
        val missing: List<String>,
    ) {
        val needsRequest: Boolean get() = missing.isNotEmpty()
    }

    private val _snapshot = MutableStateFlow(read())
    val snapshot: StateFlow<Snapshot> = _snapshot.asStateFlow()

    fun refresh(): Snapshot {
        val next = read()
        _snapshot.value = next
        return next
    }

    /** Exact permission names to pass to a multiple-permission launcher. */
    fun requestablePermissions(): Array<String> = refresh().missing.toTypedArray()

    /** Apply launcher results, then refresh observable state. */
    fun onRequestResult(results: Map<String, Boolean>): Snapshot {
        // Results are authoritative for the keys we asked about; re-query all.
        return refresh()
    }

    fun notificationsGranted(): Boolean = refresh().notificationsGranted

    fun localNetworkGranted(): Boolean = refresh().localNetworkGranted

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
        val missing = buildList {
            if (sdkInt >= 33 && !notifications) add(Manifest.permission.POST_NOTIFICATIONS)
            if (sdkInt >= 33 && !nearby) add(Manifest.permission.NEARBY_WIFI_DEVICES)
            if (sdkInt >= LOCAL_NETWORK_SDK && !localNetwork) add(PERMISSION_ACCESS_LOCAL_NETWORK)
        }
        return Snapshot(
            notificationsGranted = notifications,
            localNetworkGranted = localNetwork,
            nearbyWifiGranted = nearby,
            missing = missing,
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

        /** Permissions the app declares and may need to request at runtime. */
        fun declaredRuntimePermissions(sdkInt: Int = Build.VERSION.SDK_INT): List<String> =
            buildList {
                if (sdkInt >= 33) {
                    add(Manifest.permission.POST_NOTIFICATIONS)
                    add(Manifest.permission.NEARBY_WIFI_DEVICES)
                }
                if (sdkInt >= LOCAL_NETWORK_SDK) {
                    add(PERMISSION_ACCESS_LOCAL_NETWORK)
                }
            }
    }
}
