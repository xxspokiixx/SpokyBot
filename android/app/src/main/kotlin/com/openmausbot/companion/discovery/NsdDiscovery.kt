package com.openmausbot.companion.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import com.openmausbot.companion.core.Connection
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

data class DiscoveredService(
    val name: String,
    val host: String?,
    val port: Int?,
) {
    val id: String get() = name
}

/**
 * Discovery surface for the UI. Distinguishes "still looking", "looked and
 * found nothing", and "permission/policy failure" — NsdManager's silent empty
 * list is the Android twin of the iOS Bonjour Info.plist footgun (§19).
 */
sealed interface DiscoveryState {
    data object Idle : DiscoveryState
    data class Active(
        val browsing: Boolean,
        val found: List<DiscoveredService>,
        val failure: String? = null,
        /** True when the browser is ready and the result set is empty. */
        val emptyWhileBrowsing: Boolean = false,
    ) : DiscoveryState
}

/**
 * Multicast lock held only while an NSD browse is actually active.
 * [releaseIfHeld] is idempotent so terminal failure + [awaitClose] cannot
 * double-release.
 */
internal interface MulticastLockHandle {
    val isHeld: Boolean
    fun releaseIfHeld()
}

internal fun WifiManager.MulticastLock.asHandle(): MulticastLockHandle =
    object : MulticastLockHandle {
        override val isHeld: Boolean
            get() = this@asHandle.isHeld

        override fun releaseIfHeld() {
            runCatching {
                if (this@asHandle.isHeld) release()
            }
        }
    }

/**
 * Testable browse loop: [acquireMulticastLock] runs only when the cold Flow is
 * collected (never on Flow construction), so a never-collected Flow acquires
 * nothing and each new collection gets a fresh lock handle. Released on
 * terminal start failure (and again safely from [awaitClose]).
 */
internal fun browseDiscoveryFlow(
    serviceType: String,
    acquireMulticastLock: () -> MulticastLockHandle?,
    startBrowse: (NsdManager.DiscoveryListener) -> Unit,
    stopBrowse: (NsdManager.DiscoveryListener) -> Unit,
    resolveService: (NsdServiceInfo, (NsdServiceInfo) -> Unit) -> Unit,
    hostAddress: (NsdServiceInfo) -> String?,
    failureMessage: (Int) -> String,
): Flow<DiscoveryState> = callbackFlow {
    // Per-collection: acquire here, not at Flow construction.
    val multicastLock = acquireMulticastLock()
    val resolved = ConcurrentHashMap<String, DiscoveredService>()
    var browsing = false
    var failure: String? = null
    var lockReleased = false

    fun releaseLockOnce() {
        if (lockReleased) return
        lockReleased = true
        multicastLock?.releaseIfHeld()
    }

    fun emit() {
        val found = resolved.values.sortedBy { it.name.lowercase() }
        trySend(
            DiscoveryState.Active(
                browsing = browsing,
                found = found,
                failure = failure,
                emptyWhileBrowsing = browsing && found.isEmpty() && failure == null,
            ),
        )
    }

    trySend(DiscoveryState.Active(browsing = false, found = emptyList()))

    val discoveryListener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(regType: String) {
            browsing = true
            failure = null
            emit()
        }

        override fun onServiceFound(service: NsdServiceInfo) {
            if (service.serviceType != serviceType && !service.serviceType.contains("openmausbot")) {
                return
            }
            resolveService(service) { info ->
                resolved[info.serviceName] = DiscoveredService(
                    name = info.serviceName,
                    host = hostAddress(info),
                    port = info.port.takeIf { it > 0 },
                )
                emit()
            }
        }

        override fun onServiceLost(service: NsdServiceInfo) {
            resolved.remove(service.serviceName)
            emit()
        }

        override fun onDiscoveryStopped(regType: String) {
            browsing = false
            emit()
        }

        override fun onStartDiscoveryFailed(regType: String, errorCode: Int) {
            browsing = false
            failure = failureMessage(errorCode)
            emit()
            // Terminal: no active browse — drop the lock and close so the
            // collector cannot hold a multicast wake for the screen lifetime.
            releaseLockOnce()
            close()
        }

        override fun onStopDiscoveryFailed(regType: String, errorCode: Int) {
            browsing = false
            failure = failureMessage(errorCode)
            emit()
        }
    }

    var started = false
    try {
        startBrowse(discoveryListener)
        started = true
    } catch (error: SecurityException) {
        failure = "Local Network access is off. Enable nearby devices permission, or enter a Tailscale address below."
        emit()
        close()
    } catch (error: Exception) {
        failure = error.message
            ?: "Local discovery isn't available right now. Enter the address shown by Companion below."
        emit()
        close()
    }

    awaitClose {
        if (started) runCatching { stopBrowse(discoveryListener) }
        releaseLockOnce()
    }
}.distinctUntilChanged()

/**
 * NsdManager wrapper for `_openmausbot._tcp`, exposed as a Flow of [DiscoveryState].
 */
class NsdDiscovery(
    context: Context,
    private val serviceType: String = SERVICE_TYPE,
) {
    private val appContext = context.applicationContext
    private val nsdManager = appContext.getSystemService(NsdManager::class.java)
    private val wifiManager = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val resolveExecutor: Executor = Executors.newSingleThreadExecutor()

    fun discover(): Flow<DiscoveryState> {
        if (nsdManager == null) {
            return kotlinx.coroutines.flow.flow {
                emit(
                    DiscoveryState.Active(
                        browsing = false,
                        found = emptyList(),
                        failure = "Local discovery isn't available right now. Enter the address shown by Companion below.",
                    ),
                )
            }
        }

        // mDNS/NSD needs the multicast lock on Android 12 and earlier, and on
        // Android 13 below T extension 7 — without it browse silently returns
        // nothing even when NEARBY_WIFI_DEVICES is granted. Acquire only when
        // the cold Flow is collected so close→reopen gets a fresh held lock.
        return browseDiscoveryFlow(
            serviceType = serviceType,
            acquireMulticastLock = ::acquireMulticastLock,
            startBrowse = { listener ->
                nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
            },
            stopBrowse = { listener ->
                nsdManager.stopServiceDiscovery(listener)
            },
            resolveService = { service, onResolved -> resolve(service, onResolved) },
            hostAddress = ::hostAddress,
            failureMessage = ::failureMessage,
        )
    }

    private fun acquireMulticastLock(): MulticastLockHandle? =
        wifiManager
            ?.createMulticastLock(MULTICAST_LOCK_TAG)
            ?.apply {
                setReferenceCounted(false)
                acquire()
            }
            ?.asHandle()

    private fun resolve(service: NsdServiceInfo, onResolved: (NsdServiceInfo) -> Unit) {
        val manager = nsdManager ?: return
        if (Build.VERSION.SDK_INT >= 34) {
            manager.registerServiceInfoCallback(
                service,
                resolveExecutor,
                object : NsdManager.ServiceInfoCallback {
                    override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) = Unit
                    override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
                        onResolved(serviceInfo)
                        runCatching { manager.unregisterServiceInfoCallback(this) }
                    }
                    override fun onServiceLost() = Unit
                    override fun onServiceInfoCallbackUnregistered() = Unit
                },
            )
        } else {
            @Suppress("DEPRECATION")
            manager.resolveService(
                service,
                object : NsdManager.ResolveListener {
                    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
                    override fun onServiceResolved(serviceInfo: NsdServiceInfo) = onResolved(serviceInfo)
                },
            )
        }
    }

    fun toConnection(service: DiscoveredService): Connection? {
        val host = service.host ?: return null
        val port = service.port ?: return null
        return Connection(name = service.name, host = Connection.urlHost(host), port = port)
    }

    private fun hostAddress(info: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= 34) {
            val addresses = info.hostAddresses
            if (!addresses.isNullOrEmpty()) {
                return formatAddress(addresses.first())
            }
        }
        @Suppress("DEPRECATION")
        return info.host?.let(::formatAddress)
    }

    private fun formatAddress(address: InetAddress): String {
        val host = address.hostAddress ?: return address.hostName
        return Connection.urlHost(host)
    }

    private fun failureMessage(errorCode: Int): String = when (errorCode) {
        NsdManager.FAILURE_INTERNAL_ERROR ->
            "Local discovery isn't available right now. Enter the address shown by Companion below."
        NsdManager.FAILURE_MAX_LIMIT ->
            "Local discovery was interrupted. Retrying…"
        else ->
            "Local Network access is off. Enable nearby devices permission, or enter a Tailscale address below."
    }

    companion object {
        const val SERVICE_TYPE = "_openmausbot._tcp."
        const val MULTICAST_LOCK_TAG = "openmausbot-nsd"
    }
}

