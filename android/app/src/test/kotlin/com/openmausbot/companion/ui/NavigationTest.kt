package com.openmausbot.companion.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NavigationTest {

    @Test
    fun `the roster is the floor of the stack`() {
        val navigator = CompanionNavigator()
        assertEquals(Destination.Roster, navigator.current)
        assertFalse(navigator.canGoBack)
        navigator.pop()
        assertEquals(Destination.Roster, navigator.current)
    }

    @Test
    fun `pushing and popping walks the stack`() {
        val navigator = CompanionNavigator()
        navigator.push(Destination.Thread("t1"))
        assertTrue(navigator.canGoBack)
        assertEquals(Destination.Thread("t1"), navigator.current)
        navigator.pop()
        assertEquals(Destination.Roster, navigator.current)
    }

    @Test
    fun `pushing the destination already on top is a no-op`() {
        val navigator = CompanionNavigator()
        navigator.push(Destination.Thread("t1"))
        navigator.push(Destination.Thread("t1"))
        assertEquals(2, navigator.stack.size)
    }

    @Test
    fun `a notification tap lands on the thread with the roster behind it`() {
        val navigator = CompanionNavigator()
        navigator.push(Destination.Settings)
        navigator.openThread("t9")
        assertEquals(listOf(Destination.Roster, Destination.Thread("t9")), navigator.stack)
        navigator.pop()
        assertEquals(Destination.Roster, navigator.current)
    }

    @Test
    fun `the stack survives a round trip through the saver`() {
        val stack = listOf(
            Destination.Roster,
            Destination.Thread("thread:with:colons"),
            Destination.Computer("bot:with:colons"),
        )
        assertEquals(stack, CompanionNavigator.decode(CompanionNavigator.encode(stack)))
    }

    @Test
    fun `a computer sits above the chat it was opened from`() {
        val navigator = CompanionNavigator()
        navigator.push(Destination.Thread("t1"))
        navigator.push(Destination.Computer("bot-1"))
        assertEquals(Destination.Computer("bot-1"), navigator.current)
        navigator.pop()
        assertEquals(Destination.Thread("t1"), navigator.current)
    }

    @Test
    fun `threads and computers do not collide in saved state`() {
        val encoded = CompanionNavigator.encode(
            listOf(Destination.Thread("x"), Destination.Computer("x")),
        )
        assertEquals(encoded.size, encoded.toSet().size, "encodings must be distinguishable")
    }

    @Test
    fun `an unreadable saved entry is dropped rather than crashing`() {
        assertEquals(
            listOf(Destination.Roster, Destination.Settings),
            CompanionNavigator.decode(listOf("roster", "nonsense", "settings")),
        )
    }

    @Test
    fun `an empty restore still lands on the roster`() {
        assertEquals(listOf(Destination.Roster), CompanionNavigator(emptyList()).stack)
    }
}

/**
 * The notification tap has to fire once and only once — and "once" has to
 * survive a configuration change, because a rotation during the cold-start
 * restore is exactly when the tap is slowest to be consumed.
 */
class PendingThreadNavigationTest {

    @Test
    fun `a tap is offered to the UI`() {
        val navigation = PendingThreadNavigation()
        navigation.offer("t1")
        assertEquals("t1", navigation.pending.value)
    }

    @Test
    fun `an absent or empty extra offers nothing`() {
        val navigation = PendingThreadNavigation()
        navigation.offer(null)
        navigation.offer("")
        assertNull(navigation.pending.value)
    }

    @Test
    fun `a rotation before the UI consumed it still navigates`() {
        val launch = PendingThreadNavigation()
        launch.offer("t1")
        // Recreated without the UI ever consuming: the token is still null.
        val recreated = PendingThreadNavigation(launch.consumedThreadId())
        recreated.offer("t1")
        assertEquals("t1", recreated.pending.value)
    }

    @Test
    fun `a rotation after the UI consumed it does not navigate again`() {
        val launch = PendingThreadNavigation()
        launch.offer("t1")
        launch.consume()
        assertNull(launch.pending.value)

        val recreated = PendingThreadNavigation(launch.consumedThreadId())
        recreated.offer("t1")
        assertNull(recreated.pending.value)
    }

    @Test
    fun `tapping the same thread again while the app is up navigates again`() {
        val navigation = PendingThreadNavigation()
        navigation.offer("t1")
        navigation.consume()
        navigation.offer("t1", fresh = true)
        assertEquals("t1", navigation.pending.value)
    }

    @Test
    fun `a different thread always navigates`() {
        val navigation = PendingThreadNavigation()
        navigation.offer("t1")
        navigation.consume()
        navigation.offer("t2")
        assertEquals("t2", navigation.pending.value)
    }
}

/**
 * The camera can only be released by the screen that opened it, and the provider
 * future can land after the user has already left. What cannot happen is the
 * camera staying live with nothing on screen.
 */
class CameraLifecycleTest {

    @Test
    fun `binding then leaving releases once`() {
        var released = 0
        val lifecycle = CameraLifecycle()
        lifecycle.bound { released += 1 }
        lifecycle.release()
        lifecycle.release()
        assertEquals(1, released)
    }

    @Test
    fun `a provider that arrives after disposal is torn down immediately`() {
        var released = 0
        val lifecycle = CameraLifecycle()
        lifecycle.release()
        lifecycle.bound { released += 1 }
        assertEquals(1, released)
    }

    @Test
    fun `releasing without ever binding is harmless`() {
        CameraLifecycle().release()
    }

    @Test
    fun `an analyzer whose binding throws is still released`() {
        var released = 0
        val lifecycle = CameraLifecycle()
        val started = lifecycle.startAnalyzing(
            createAnalyzer = { "analyzer" },
            releaseAnalyzer = { released += 1 },
            bind = { error("no camera on this device") },
        )
        assertFalse(started)
        assertEquals(1, released)
        // Leaving the screen afterwards must not release it a second time.
        lifecycle.release()
        assertEquals(1, released)
    }

    @Test
    fun `a bound analyzer is released when the screen goes away`() {
        var released = 0
        var bound = 0
        val lifecycle = CameraLifecycle()
        val started = lifecycle.startAnalyzing(
            createAnalyzer = { "analyzer" },
            releaseAnalyzer = { released += 1 },
            bind = { bound += 1 },
        )
        assertTrue(started)
        assertEquals(1, bound)
        assertEquals(0, released)
        lifecycle.release()
        assertEquals(1, released)
    }

    @Test
    fun `rebinding releases what was held before`() {
        var first = 0
        var second = 0
        val lifecycle = CameraLifecycle()
        lifecycle.bound { first += 1 }
        lifecycle.bound { second += 1 }
        assertEquals(1, first)
        lifecycle.release()
        assertEquals(1, second)
    }
}
