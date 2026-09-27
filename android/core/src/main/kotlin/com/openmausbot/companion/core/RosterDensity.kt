package com.openmausbot.companion.core

/**
 * How much each row on the home list says — the port of
 * `ios/Sources/CompanionCore/RosterDensity.swift`.
 *
 * The phone follows the desktop sidebar's density setting
 * (`src/lib/sidebar-preferences.ts`) without its avatars-only mode, which a
 * phone has no room to need. Comfortable is the original two-line row with a
 * "Threads" disclosure beneath every bot; compact is one line per bot, status
 * as small marks, and a thread list only where there is one to open.
 *
 * The decisions live here, away from Compose, so both densities read the same
 * facts and the rules can be tested without a screen.
 */
enum class RosterDensity(val wireValue: String, val label: String, val caption: String) {
    COMFORTABLE(
        "comfortable",
        "Comfortable",
        "Larger faces, with each bot's latest message under its name.",
    ),
    COMPACT(
        "compact",
        "Compact",
        "One line per bot. Bots with more than one thread show how many; tap the number to list them.",
    ),
    ;

    companion object {
        /** What a new install shows. */
        val DEFAULT: RosterDensity = COMPACT

        /**
         * A stored choice, read defensively: anything unreadable — including
         * the desktop's "icons" — lands on the default rather than a surprise.
         */
        fun fromWire(value: String?): RosterDensity =
            entries.firstOrNull { it.wireValue == value } ?: DEFAULT
    }
}

/** The one live signal a bot's row carries, most urgent first — the desktop row's order. */
enum class RosterRowStatus {
    /** Nothing is happening: the row shows when the bot last spoke. */
    IDLE,

    /** A thread is mid-turn. */
    WORKING,

    /**
     * The bot stopped for the person. Outranks work: the harness counts a wait
     * on the person as busy, and the person is who the row is for.
     */
    WAITING_ON_YOU,
}

/**
 * The threads the home list would show for this bot when it is opened: the
 * same fold as the thread tree, so the count never disagrees with the list it
 * opens. Routine runs and put-away threads stay out.
 */
fun Bot.rosterThreadCount(
    queuedThreadIds: Set<String> = emptySet(),
    now: Long = System.currentTimeMillis(),
): Int = threadGroups(now = now, queuedThreadIds = queuedThreadIds).sumOf { it.tasks.size }

/**
 * Read from every visible thread, not just the one open on the desktop, so a
 * bot working in the background still shows it.
 *
 * @param hasPendingCard an unanswered approval or question sits in one of
 * this bot's threads. Cards live in transcripts, which the bot record does
 * not carry.
 */
fun Bot.rosterStatus(hasPendingCard: Boolean): RosterRowStatus {
    val threads = visibleTasks
    if (hasPendingCard || threads.any { it.activity == "waiting-on-you" }) {
        return RosterRowStatus.WAITING_ON_YOU
    }
    // A teammate wait is painted busy on the wire; the flag alone decides
    // that it is a quiet wait, never the work spinner.
    val botWorks = busy == true && waitingOnTeammate != true
    if (botWorks || threads.any { it.isWorking && !it.isWaitingOnTeammate }) {
        return RosterRowStatus.WORKING
    }
    return RosterRowStatus.IDLE
}

/** Everything one bot's row decides, as data. */
data class RosterBotRow(
    val density: RosterDensity,
    val status: RosterRowStatus,
    /** Threads behind the compact "› N" control. */
    val threadCount: Int,
    val isChief: Boolean,
    val unread: Boolean,
) {
    constructor(
        bot: Bot,
        density: RosterDensity,
        hasPendingCard: Boolean,
        queuedThreadIds: Set<String> = emptySet(),
        now: Long = System.currentTimeMillis(),
    ) : this(
        density = density,
        status = bot.rosterStatus(hasPendingCard),
        threadCount = bot.rosterThreadCount(queuedThreadIds, now),
        isChief = bot.chiefOfStaff == true,
        unread = bot.unread,
    )

    /** Compact is one line: no last-message preview. */
    val showsPreview: Boolean get() = density == RosterDensity.COMFORTABLE

    /** Comfortable keeps its "Threads N" disclosure beneath every bot. */
    val showsThreadsRow: Boolean get() = density == RosterDensity.COMFORTABLE

    /**
     * Compact gives the "› N" control only to a bot with a list to open. One
     * thread is the bot itself: tapping the row already opens it.
     */
    val showsThreadControl: Boolean get() = density == RosterDensity.COMPACT && threadCount >= 2

    /** The Chief of Staff crown after the name. Comfortable keeps the look it shipped with. */
    val showsChiefBadge: Boolean get() = density == RosterDensity.COMPACT && isChief

    /** Compact rows put the spinner where the time was. */
    val showsTime: Boolean get() = !(density == RosterDensity.COMPACT && status == RosterRowStatus.WORKING)

    val showsSpinner: Boolean get() = status == RosterRowStatus.WORKING

    val showsWaiting: Boolean get() = status == RosterRowStatus.WAITING_ON_YOU

    /** As it always was: the dot steps aside while the bot works. */
    val showsUnreadDot: Boolean get() = unread && status != RosterRowStatus.WORKING

    /**
     * Whether the bot's threads are listed beneath its row. A search lists
     * what matched under every bot, as the desktop does; otherwise compact
     * lists only a bot the person opened with its "› N" control.
     */
    fun listsThreads(expanded: Boolean, searching: Boolean): Boolean = when (density) {
        RosterDensity.COMFORTABLE -> searching || expanded
        RosterDensity.COMPACT -> searching || (expanded && showsThreadControl)
    }

    /**
     * A compact list the person opened ends with "+ New thread". Search
     * results are not a place to create one, and comfortable keeps its "+" on
     * the "Threads" row.
     */
    fun endsWithNewThread(expanded: Boolean, searching: Boolean): Boolean =
        density == RosterDensity.COMPACT && !searching && expanded && showsThreadControl
}
