package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotTask

/**
 * A bot's separate contexts — the rules behind `ios/App/TaskManagerView.swift`.
 *
 * Tasks are conversation navigation, not host configuration, which is why they
 * are a compact sheet rather than a screen. Rooms never see them (§12): a room
 * has no task list of its own.
 */
object TaskRules {
    const val UNTITLED = "Untitled task"

    fun tasks(bot: Bot): List<BotTask> = bot.tasks.orEmpty()

    fun title(task: BotTask): String = task.title.ifEmpty { UNTITLED }

    fun isCurrent(task: BotTask, bot: Bot): Boolean = task.threadId == bot.threadId

    /** A running bot is mid-turn; the harness refuses task changes underneath it. */
    fun canCreate(bot: Bot): Boolean = bot.busy != true

    /** The last task cannot go — a bot without one has nowhere to talk. */
    fun canDelete(task: BotTask, bot: Bot): Boolean =
        tasks(bot).size > 1 && bot.busy != true && tasks(bot).any { it.threadId == task.threadId }

    /**
     * Switching away from the task a bot is working in is the same refusal as
     * creating or deleting one, so the button says so rather than letting the
     * harness answer 409. Already being on a task is not a switch.
     */
    fun canSwitch(task: BotTask, bot: Bot): Boolean = bot.busy != true && !isCurrent(task, bot)

    /** Renaming is allowed while busy: it touches the label, not the thread. */
    fun canRename(bot: Bot): Boolean = true
}

/**
 * The two title dialogs, whose enabling has to keep following the bot after they
 * are already on screen: a bot can start running while the dialog is open, and a
 * Create button that stays lit then just collects a 409.
 */
object TaskDialogRules {
    /** Live: [bot] is re-read from the stream on every frame. */
    fun createEnabled(bot: Bot): Boolean = TaskRules.canCreate(bot)

    /**
     * Renaming has no busy gate and no emptiness gate. iOS sends the field as
     * typed and the server labels an empty title as the untitled task — refusing
     * to submit it would be this screen inventing a rule the product does not
     * have.
     */
    fun renameEnabled(bot: Bot, title: String): Boolean = TaskRules.canRename(bot)

    /** Create trims, and an empty title means "let the harness name it". */
    fun createTitle(raw: String): String? = raw.trim().ifEmpty { null }

    /** Rename sends the field as typed, as iOS does. */
    fun renameTitle(raw: String): String = raw
}
