package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * What a home-list row shows at each density, without a screen — the port of
 * `ios/Tests/CompanionCoreTests/RosterDensityTests.swift`.
 *
 * Compact is one line per bot: no preview, a "› N" control only where there
 * is a list to open, and status as small marks. Comfortable is the original
 * two-line row with its "Threads" disclosure beneath every bot. Both read the
 * same facts, so switching density never changes what a bot is doing.
 */
class RosterDensityTest {
    // The setting

    @Test
    fun compactIsTheDefault() {
        assertEquals(RosterDensity.COMPACT, RosterDensity.DEFAULT)
        assertEquals(RosterDensity.COMPACT, RosterDensity.fromWire(null))
    }

    @Test
    fun storedChoicesRoundTrip() {
        RosterDensity.entries.forEach { density ->
            assertEquals(density, RosterDensity.fromWire(density.wireValue))
        }
        assertEquals(listOf(RosterDensity.COMFORTABLE, RosterDensity.COMPACT), RosterDensity.entries)
        assertEquals(listOf("comfortable", "compact"), RosterDensity.entries.map { it.wireValue })
    }

    /** The desktop also stores "icons"; a phone has no avatars-only mode, and
     * a value it cannot read must land on the default, not on comfortable. */
    @Test
    fun unreadableStoredValuesFallBackToCompact() {
        assertEquals(RosterDensity.COMPACT, RosterDensity.fromWire("icons"))
        assertEquals(RosterDensity.COMPACT, RosterDensity.fromWire(""))
        assertEquals(RosterDensity.COMPACT, RosterDensity.fromWire("Compact"))
        assertEquals(RosterDensity.COMPACT, RosterDensity.fromWire("COMFORTABLE"))
    }

    @Test
    fun settingsNamesBothChoicesAndSaysWhatEachDoes() {
        assertEquals(listOf("Comfortable", "Compact"), RosterDensity.entries.map { it.label })
        RosterDensity.entries.forEach { assertTrue(it.caption.isNotBlank()) }
    }

    // Thread count behind "› N"

    @Test
    fun threadCountMatchesTheTreeAndSkipsRoutineRuns() {
        val bot = bot(listOf(task("a"), task("b"), task("run", routine = true)))
        assertEquals(2, bot.rosterThreadCount())
        assertEquals(bot.threadGroups().sumOf { it.tasks.size }, bot.rosterThreadCount())
    }

    @Test
    fun threadCountLeavesOutFoldedThreadsLikeTheTree() {
        val closed = task("closed").copy(closedBy = ThreadCloser(botId = "pm", name = "PM", at = 1.0))
        val archived = task("archived").copy(archivedAt = 1.0)
        assertEquals(1, bot(listOf(task("a"), closed, archived)).rosterThreadCount())
    }

    /** Android's tree folds a sleeping thread too, until its clock runs out. */
    @Test
    fun threadCountLeavesOutSnoozedThreadsUntilTheyWake() {
        val asleep = task("asleep").copy(snoozedUntil = 0.0)
        val timed = task("timed").copy(snoozedUntil = 2_000.0)
        val bot = bot(listOf(task("a"), asleep, timed))
        assertEquals(1, bot.rosterThreadCount(now = 1_000))
        assertEquals(2, bot.rosterThreadCount(now = 3_000))
    }

    /** A closed thread holding a queued send stays in the tree, so it counts. */
    @Test
    fun threadCountKeepsAFoldedThreadWithAHeldSend() {
        val closed = task("closed").copy(closedBy = ThreadCloser(botId = "pm", name = "PM", at = 1.0))
        assertEquals(2, bot(listOf(task("a"), closed)).rosterThreadCount(queuedThreadIds = setOf("closed")))
    }

    /** Older computers send no task list: that is one conversation. */
    @Test
    fun legacyBotWithoutTasksHasOneThread() {
        assertEquals(1, bot(emptyList()).copy(tasks = null).rosterThreadCount())
    }

    // Status

    @Test
    fun idleBotHasNoStatus() {
        assertEquals(RosterRowStatus.IDLE, bot(listOf(task("a"))).rosterStatus(hasPendingCard = false))
    }

    @Test
    fun anyWorkingThreadMakesTheBotWork() {
        val background = task("b").copy(activity = "working")
        assertEquals(
            RosterRowStatus.WORKING,
            bot(listOf(task("a"), background)).rosterStatus(hasPendingCard = false),
        )
        assertEquals(
            RosterRowStatus.WORKING,
            bot(listOf(task("a"))).copy(busy = true).rosterStatus(hasPendingCard = false),
        )
    }

    /** The harness counts waiting-on-you as busy. The person comes first. */
    @Test
    fun waitingOnYouOutranksWorking() {
        val waiting = task("a").copy(activity = "waiting-on-you", busy = true)
        assertEquals(
            RosterRowStatus.WAITING_ON_YOU,
            bot(listOf(waiting)).copy(busy = true).rosterStatus(hasPendingCard = false),
        )
    }

    @Test
    fun anUnansweredCardMeansWaitingOnYou() {
        assertEquals(
            RosterRowStatus.WAITING_ON_YOU,
            bot(listOf(task("a"))).copy(busy = true).rosterStatus(hasPendingCard = true),
        )
    }

    /** A teammate wait is a quiet wait, never the work spinner. */
    @Test
    fun teammateWaitIsNotWork() {
        val waiting = task("a").copy(busy = true, activity = "working", waitingOnTeammate = true)
        val bot = bot(listOf(waiting)).copy(busy = true, waitingOnTeammate = true)
        assertEquals(RosterRowStatus.IDLE, bot.rosterStatus(hasPendingCard = false))
    }

    @Test
    fun routineRunsDoNotMakeTheRowWork() {
        val run = task("run", routine = true).copy(busy = true)
        assertEquals(RosterRowStatus.IDLE, bot(listOf(task("a"), run)).rosterStatus(hasPendingCard = false))
    }

    // Compact row

    @Test
    fun compactRowIsOneLineWithoutAPreview() {
        val row = RosterBotRow(bot(listOf(task("a"))), RosterDensity.COMPACT, hasPendingCard = false)
        assertFalse(row.showsPreview)
        assertFalse(row.showsThreadsRow)
    }

    @Test
    fun singleThreadBotHasNoThreadControl() {
        val row = RosterBotRow(bot(listOf(task("a"))), RosterDensity.COMPACT, hasPendingCard = false)
        assertEquals(1, row.threadCount)
        assertFalse(row.showsThreadControl)
        assertFalse(row.listsThreads(expanded = true, searching = false))
        assertFalse(row.endsWithNewThread(expanded = true, searching = false))
    }

    @Test
    fun multiThreadBotOpensItsListWithNewThreadAtTheEnd() {
        val row = RosterBotRow(bot(listOf(task("a"), task("b"))), RosterDensity.COMPACT, hasPendingCard = false)
        assertTrue(row.showsThreadControl)
        assertEquals(2, row.threadCount)
        assertFalse(row.listsThreads(expanded = false, searching = false))
        assertTrue(row.listsThreads(expanded = true, searching = false))
        assertTrue(row.endsWithNewThread(expanded = true, searching = false))
        assertFalse(row.endsWithNewThread(expanded = false, searching = false))
    }

    /** Search lists what matched under every bot, as the desktop does;
     * results are not a place to create a thread. */
    @Test
    fun searchListsMatchesWithoutNewThread() {
        val single = RosterBotRow(bot(listOf(task("a"))), RosterDensity.COMPACT, hasPendingCard = false)
        assertTrue(single.listsThreads(expanded = false, searching = true))
        assertFalse(single.endsWithNewThread(expanded = false, searching = true))

        val multi = RosterBotRow(bot(listOf(task("a"), task("b"))), RosterDensity.COMPACT, hasPendingCard = false)
        assertTrue(multi.listsThreads(expanded = true, searching = true))
        assertFalse(multi.endsWithNewThread(expanded = true, searching = true))
    }

    @Test
    fun compactWorkingRowSwapsTheTimeForASpinner() {
        val row = RosterBotRow(bot(listOf(task("a"))).copy(busy = true), RosterDensity.COMPACT, hasPendingCard = false)
        assertTrue(row.showsSpinner)
        assertFalse(row.showsTime)
    }

    @Test
    fun compactWaitingRowKeepsItsTimeAndShowsTheHand() {
        val waiting = task("a").copy(activity = "waiting-on-you")
        val row = RosterBotRow(bot(listOf(waiting)).copy(busy = true), RosterDensity.COMPACT, hasPendingCard = false)
        assertTrue(row.showsWaiting)
        assertFalse(row.showsSpinner)
        assertTrue(row.showsTime)
    }

    @Test
    fun chiefOfStaffIsMarkedInCompactOnly() {
        val chief = bot(listOf(task("a"))).copy(chiefOfStaff = true)
        assertTrue(RosterBotRow(chief, RosterDensity.COMPACT, hasPendingCard = false).showsChiefBadge)
        assertFalse(RosterBotRow(chief, RosterDensity.COMFORTABLE, hasPendingCard = false).showsChiefBadge)
        assertFalse(RosterBotRow(bot(listOf(task("a"))), RosterDensity.COMPACT, hasPendingCard = false).showsChiefBadge)
    }

    /** The dot stays as it was: hidden while the bot works. */
    @Test
    fun unreadDotHidesWhileWorking() {
        val unread = bot(listOf(task("a"))).copy(unread = true)
        assertTrue(RosterBotRow(unread, RosterDensity.COMPACT, hasPendingCard = false).showsUnreadDot)
        assertFalse(RosterBotRow(unread.copy(busy = true), RosterDensity.COMPACT, hasPendingCard = false).showsUnreadDot)
    }

    // Comfortable row keeps what shipped

    @Test
    fun comfortableKeepsPreviewTimeAndThreadsRow() {
        val row = RosterBotRow(bot(listOf(task("a"))).copy(busy = true), RosterDensity.COMFORTABLE, hasPendingCard = false)
        assertTrue(row.showsPreview)
        assertTrue(row.showsThreadsRow)
        assertTrue(row.showsTime)
        assertTrue(row.showsSpinner)
        assertFalse(row.showsThreadControl)
        assertFalse(row.endsWithNewThread(expanded = true, searching = false))
    }

    // Helpers

    private fun task(id: String, routine: Boolean = false): BotTask =
        BotTask(threadId = id, title = id, createdAt = 1.0, routineRunId = if (routine) "run-$id" else null)

    private fun bot(tasks: List<BotTask>): Bot = Bot(
        id = "bot", threadId = tasks.firstOrNull()?.threadId ?: "bot-thread", name = "Bot", title = "Helper",
        description = "", notifications = true, color = "blue", unread = false,
        modelSelection = ModelSelection("i", "m"), createdAt = 1.0,
        tasks = tasks,
    )
}
