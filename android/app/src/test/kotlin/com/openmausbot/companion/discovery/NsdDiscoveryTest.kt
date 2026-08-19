package com.openmausbot.companion.discovery

import android.net.nsd.NsdManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotSame
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

@OptIn(ExperimentalCoroutinesApi::class)
class NsdDiscoveryTest {
    @Test
    fun startDiscoveryFailedReleasesLockClosesFlowAndIsIdempotent() = runTest {
        val lock = FakeMulticastLock(held = true)
        var captured: NsdManager.DiscoveryListener? = null
        var stopCalls = 0
        val states = mutableListOf<DiscoveryState>()

        val collectJob = launch {
            browseDiscoveryFlow(
                serviceType = NsdDiscovery.SERVICE_TYPE,
                acquireMulticastLock = { lock },
                startBrowse = { listener -> captured = listener },
                stopBrowse = { stopCalls++ },
                resolveService = { _, _ -> },
                hostAddress = { null },
                failureMessage = { code -> "failed:$code" },
            ).collect { states += it }
        }
        runCurrent()

        val listener = requireNotNull(captured)
        listener.onStartDiscoveryFailed(NsdDiscovery.SERVICE_TYPE, NsdManager.FAILURE_INTERNAL_ERROR)
        advanceUntilIdle()

        assertFalse(lock.isHeld)
        assertEquals(1, lock.releaseCount)
        assertTrue(collectJob.isCompleted)
        assertEquals(1, stopCalls)

        val last = assertIs<DiscoveryState.Active>(states.last())
        assertFalse(last.browsing)
        assertEquals("failed:${NsdManager.FAILURE_INTERNAL_ERROR}", last.failure)
        assertTrue(last.found.isEmpty())
    }

    @Test
    fun securityExceptionOnStartReleasesLockAndClosesFlow() = runTest {
        val lock = FakeMulticastLock(held = true)
        val states = mutableListOf<DiscoveryState>()

        val collectJob = launch {
            browseDiscoveryFlow(
                serviceType = NsdDiscovery.SERVICE_TYPE,
                acquireMulticastLock = { lock },
                startBrowse = { throw SecurityException("denied") },
                stopBrowse = { error("stop should not run when browse never started") },
                resolveService = { _, _ -> },
                hostAddress = { null },
                failureMessage = { "unused" },
            ).collect { states += it }
        }
        advanceUntilIdle()

        assertFalse(lock.isHeld)
        assertEquals(1, lock.releaseCount)
        assertTrue(collectJob.isCompleted)
        val last = assertIs<DiscoveryState.Active>(states.last())
        assertFalse(last.browsing)
        assertTrue(last.failure!!.contains("Local Network"))
    }

    @Test
    fun successfulBrowseKeepsLockUntilCollectorCancels() = runTest {
        val lock = FakeMulticastLock(held = true)
        var captured: NsdManager.DiscoveryListener? = null
        val states = mutableListOf<DiscoveryState>()

        val collectJob = launch {
            browseDiscoveryFlow(
                serviceType = NsdDiscovery.SERVICE_TYPE,
                acquireMulticastLock = { lock },
                startBrowse = { listener -> captured = listener },
                stopBrowse = { },
                resolveService = { _, _ -> },
                hostAddress = { null },
                failureMessage = { "unused" },
            ).collect { states += it }
        }
        runCurrent()
        captured!!.onDiscoveryStarted(NsdDiscovery.SERVICE_TYPE)
        runCurrent()

        assertTrue(lock.isHeld)
        assertEquals(0, lock.releaseCount)
        val active = assertIs<DiscoveryState.Active>(states.last())
        assertTrue(active.browsing)
        assertNull(active.failure)

        collectJob.cancel()
        advanceUntilIdle()
        assertFalse(lock.isHeld)
        assertEquals(1, lock.releaseCount)
    }

    @Test
    fun productionFactoryPathAcquiresPerCollectionOnly() = runTest {
        // Mirrors discover()'s acquireMulticastLock factory: create+hold only when
        // invoked from inside the cold Flow's collection block.
        val locks = mutableListOf<FakeMulticastLock>()
        var acquireCalls = 0
        val acquireMulticastLock: () -> MulticastLockHandle? = {
            acquireCalls++
            FakeMulticastLock(held = true).also { locks += it }
        }

        var captured: NsdManager.DiscoveryListener? = null
        var browseStarts = 0

        val flow = browseDiscoveryFlow(
            serviceType = NsdDiscovery.SERVICE_TYPE,
            acquireMulticastLock = acquireMulticastLock,
            startBrowse = { listener ->
                browseStarts++
                captured = listener
            },
            stopBrowse = { },
            resolveService = { _, _ -> },
            hostAddress = { null },
            failureMessage = { "unused" },
        )

        // (a) Creating the cold Flow without collecting acquires nothing.
        assertEquals(0, acquireCalls)
        assertTrue(locks.isEmpty())
        assertEquals(0, browseStarts)

        // (b) First collection acquires; terminal close releases exactly once.
        val firstStates = mutableListOf<DiscoveryState>()
        val firstJob = launch { flow.collect { firstStates += it } }
        runCurrent()

        assertEquals(1, acquireCalls)
        assertEquals(1, locks.size)
        assertEquals(1, browseStarts)
        assertTrue(locks[0].isHeld)
        assertEquals(0, locks[0].releaseCount)

        captured!!.onDiscoveryStarted(NsdDiscovery.SERVICE_TYPE)
        runCurrent()
        assertTrue(assertIs<DiscoveryState.Active>(firstStates.last()).browsing)
        assertTrue(locks[0].isHeld)

        firstJob.cancel()
        advanceUntilIdle()
        assertFalse(locks[0].isHeld)
        assertEquals(1, locks[0].releaseCount)

        // (c) Second collection after the first completes gets a fresh held
        // handle; browse runs locked again (screen close → reopen).
        captured = null
        val secondStates = mutableListOf<DiscoveryState>()
        val secondJob = launch { flow.collect { secondStates += it } }
        runCurrent()

        assertEquals(2, acquireCalls)
        assertEquals(2, locks.size)
        assertEquals(2, browseStarts)
        assertNotSame(locks[0], locks[1])
        assertTrue(locks[1].isHeld)
        assertEquals(0, locks[1].releaseCount)
        // Prior collection's lock stays released — no reuse of a dead handle.
        assertFalse(locks[0].isHeld)

        captured!!.onDiscoveryStarted(NsdDiscovery.SERVICE_TYPE)
        runCurrent()
        assertTrue(assertIs<DiscoveryState.Active>(secondStates.last()).browsing)
        assertTrue(locks[1].isHeld)

        secondJob.cancel()
        advanceUntilIdle()
        assertFalse(locks[1].isHeld)
        assertEquals(1, locks[1].releaseCount)
    }
}

private class FakeMulticastLock(held: Boolean) : MulticastLockHandle {
    private var held = held
    var releaseCount = 0
        private set

    override val isHeld: Boolean
        get() = held

    override fun releaseIfHeld() {
        if (!held) return
        held = false
        releaseCount++
    }
}
