package com.openmausbot.companion.permissions

import android.Manifest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CompanionPermissionsTest {
    @Test
    fun api37ListsNotificationsNearbyAndLocalNetwork() {
        val granted = mutableSetOf<String>()
        val permissions = CompanionPermissions(
            sdkInt = 37,
            granted = { it in granted },
        )
        val missing = permissions.requestablePermissions().toList()
        assertEquals(
            listOf(
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.NEARBY_WIFI_DEVICES,
                CompanionPermissions.PERMISSION_ACCESS_LOCAL_NETWORK,
            ),
            missing,
        )
        assertTrue(permissions.snapshot.value.needsRequest)
        assertFalse(permissions.notificationsGranted())
        assertFalse(permissions.localNetworkGranted())
    }

    @Test
    fun api32NeedsNoRuntimeCompanionPermissions() {
        val permissions = CompanionPermissions(
            sdkInt = 32,
            granted = { false },
        )
        assertTrue(permissions.requestablePermissions().isEmpty())
        assertTrue(permissions.notificationsGranted())
        assertTrue(permissions.localNetworkGranted())
    }

    @Test
    fun onRequestResultRefreshesObservableSnapshot() {
        val granted = mutableSetOf<String>()
        val permissions = CompanionPermissions(
            sdkInt = 33,
            granted = { it in granted },
        )
        assertTrue(permissions.snapshot.value.needsRequest)
        granted += Manifest.permission.POST_NOTIFICATIONS
        granted += Manifest.permission.NEARBY_WIFI_DEVICES
        val snap = permissions.onRequestResult(
            mapOf(
                Manifest.permission.POST_NOTIFICATIONS to true,
                Manifest.permission.NEARBY_WIFI_DEVICES to true,
            ),
        )
        assertTrue(snap.notificationsGranted)
        assertTrue(snap.nearbyWifiGranted)
        assertFalse(snap.needsRequest)
    }

    @Test
    fun declaredRuntimePermissionsMatchSdkGates() {
        assertEquals(
            listOf(
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.NEARBY_WIFI_DEVICES,
                CompanionPermissions.PERMISSION_ACCESS_LOCAL_NETWORK,
                Manifest.permission.RECORD_AUDIO,
            ),
            CompanionPermissions.declaredRuntimePermissions(37),
        )
        assertEquals(
            listOf(
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.NEARBY_WIFI_DEVICES,
                Manifest.permission.RECORD_AUDIO,
            ),
            CompanionPermissions.declaredRuntimePermissions(33),
        )
        assertEquals(
            listOf(Manifest.permission.RECORD_AUDIO),
            CompanionPermissions.declaredRuntimePermissions(32),
        )
    }

    @Test
    fun recordAudioIsNeverPartOfTheStartupPrompt() {
        val permissions = CompanionPermissions(
            sdkInt = 37,
            granted = { false },
        )
        assertFalse(permissions.recordAudioGranted())
        assertFalse(
            permissions.requestablePermissions().contains(Manifest.permission.RECORD_AUDIO),
            "RECORD_AUDIO must only be asked from the mic button",
        )
        assertEquals(
            Manifest.permission.RECORD_AUDIO,
            CompanionPermissions.requestableRecordAudio(granted = false),
        )
        assertEquals(null, CompanionPermissions.requestableRecordAudio(granted = true))
    }
}
