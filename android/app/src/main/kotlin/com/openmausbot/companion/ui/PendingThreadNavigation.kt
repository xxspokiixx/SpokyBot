package com.openmausbot.companion.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A notification tap, delivered to the UI exactly once.
 *
 * Two failure modes to avoid at the same time, which is why this is not simply
 * "clear the extra":
 *
 * - The Intent that launched the Activity is handed back on every recreation, so
 *   stripping nothing would re-navigate on every rotation, dragging the reader
 *   back into a thread they had already left.
 * - Stripping the extra as soon as it is read loses it if the process is
 *   recreated *before* the composition consumed it — a rotation during the
 *   cold-start restore, which is exactly when a notification tap is slowest.
 *
 * So the extra stays on the Intent and what is remembered is which thread has
 * already been navigated to. That token rides in the Activity's saved instance
 * state (memory, not disk), so it survives a configuration change and is gone on
 * a genuinely fresh launch.
 */
class PendingThreadNavigation(consumedThreadId: String? = null) {
    private val _pending = MutableStateFlow<String?>(null)
    val pending: StateFlow<String?> = _pending.asStateFlow()

    private var consumed: String? = consumedThreadId

    /**
     * @param fresh true for a tap delivered while the Activity was already alive
     *   (`onNewIntent`), which is always a new request even for the same thread.
     */
    fun offer(threadId: String?, fresh: Boolean = false) {
        val id = threadId?.takeIf { it.isNotEmpty() } ?: return
        if (fresh) {
            consumed = null
        } else if (id == consumed) {
            return
        }
        _pending.value = id
    }

    /** The UI navigated: do not offer this thread again after a recreation. */
    fun consume() {
        consumed = _pending.value ?: consumed
        _pending.value = null
    }

    /** The token to write into saved instance state. */
    fun consumedThreadId(): String? = consumed
}
