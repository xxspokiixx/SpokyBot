package com.openmausbot.companion.permissions

import android.Manifest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CompanionPermissionsTest {
    /**
     * The two lists are separate, and each holds only what its own moment
     * earns. A single "everything missing" list is what put a notification
     * dialog and a nearby-devices dialog on the first frame of a first launch;
     * the split is the fix, so a request that names something from the other
     * moment is the regression this asserts against.
     */
    @Test
    fun api37SplitsNotificationsFromWhatABrowseNeeds() {
        val granted = mutableSetOf<String>()
        val permissions = CompanionPermissions(
            sdkInt = 37,
            granted = { it in granted },
        )
        assertEquals(
            listOf(Manifest.permission.POST_NOTIFICATIONS),
            permissions.notificationPermissions().toList(),
        )
        assertEquals(
            listOf(
                Manifest.permission.NEARBY_WIFI_DEVICES,
                CompanionPermissions.PERMISSION_ACCESS_LOCAL_NETWORK,
            ),
            permissions.discoveryPermissions().toList(),
        )
        assertFalse(
            permissions.discoveryPermissions().contains(Manifest.permission.POST_NOTIFICATIONS),
            "opening the list of nearby computers must not ask for notifications",
        )
        assertFalse(
            permissions.notificationPermissions()
                .contains(Manifest.permission.NEARBY_WIFI_DEVICES),
            "the explained notification step must not ask for network access",
        )
        assertTrue(permissions.snapshot.value.discoveryNeedsRequest)
        assertFalse(permissions.notificationsGranted())
        assertFalse(permissions.localNetworkGranted())
    }

    @Test
    fun grantingOneMomentDoesNotEmptyTheOther() {
        val granted = mutableSetOf(Manifest.permission.POST_NOTIFICATIONS)
        val permissions = CompanionPermissions(
            sdkInt = 37,
            granted = { it in granted },
        )
        assertTrue(permissions.notificationPermissions().isEmpty())
        assertEquals(2, permissions.discoveryPermissions().size)
    }

    @Test
    fun api32NeedsNoRuntimeCompanionPermissions() {
        val permissions = CompanionPermissions(
            sdkInt = 32,
            granted = { false },
        )
        assertTrue(permissions.notificationPermissions().isEmpty())
        assertTrue(permissions.discoveryPermissions().isEmpty())
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
        assertTrue(permissions.snapshot.value.discoveryNeedsRequest)
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
        assertFalse(snap.discoveryNeedsRequest)
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
            permissions.notificationPermissions().contains(Manifest.permission.RECORD_AUDIO),
            "RECORD_AUDIO must only be asked from the mic button",
        )
        assertFalse(
            permissions.discoveryPermissions().contains(Manifest.permission.RECORD_AUDIO),
            "RECORD_AUDIO must only be asked from the mic button",
        )
        assertEquals(
            Manifest.permission.RECORD_AUDIO,
            CompanionPermissions.requestableRecordAudio(granted = false),
        )
        assertEquals(null, CompanionPermissions.requestableRecordAudio(granted = true))
    }
}
