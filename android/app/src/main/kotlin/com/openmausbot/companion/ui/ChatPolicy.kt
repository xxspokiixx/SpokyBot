package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChatSummary
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.Reaction

/**
 * The decisions the chat and roster screens make that are worth testing without
 * a device. Everything here is pure; the composables call in, they do not
 * re-derive.
 */

/**
 * Turning a thread id into a chat, honestly.
 *
 * A notification tap can arrive at a cold start, before the stream has said
 * hello and the fleet has been hydrated. At that moment no thread exists, and
 * treating "not found" as "deleted" would bounce the reader straight back to the
 * roster — the tap would open nothing, which is the one thing the notification
 * promised.
 *
 * `cursor` is the honest signal: `Session` commits `resetCursor` only after a
 * cold hydrate succeeds, and a fresh process starts with none.
 */
object ThreadResolution {
    sealed interface Result {
        data class Open(val chat: Chat) : Result

        /** Nothing has been hydrated yet — wait, do not conclude anything. */
        data object Waiting : Result

        /** The fleet is known and this thread is not in it. */
        data object Gone : Result
    }

    fun hydrated(state: CompanionState): Boolean =
        state.cursor != null || state.bots.isNotEmpty() || state.rooms.isNotEmpty()

    /** The chat behind a thread id, or null while it is unknown either way. */
    fun chatOrNull(state: CompanionState, threadId: String): Chat? =
        (resolve(state, threadId) as? Result.Open)?.chat

    fun resolve(state: CompanionState, threadId: String): Result {
        state.botForThread(threadId)?.let { return Result.Open(Chat.BotChat(it)) }
        state.roomForThread(threadId)?.let { return Result.Open(Chat.RoomChat(it)) }
        // A bot that switched task now answers to a different thread, and a
        // notification may name a task that is no longer the open one. The chat
        // follows the bot, not the thread it was opened on — so a thread that is
        // one of a bot's tasks still resolves to that bot, and the screen shows
        // whichever task the bot is in now.
        state.bots
            .firstOrNull { bot -> bot.tasks.orEmpty().any { it.threadId == threadId } }
            ?.let { return Result.Open(Chat.BotChat(it)) }
        return if (hydrated(state)) Result.Gone else Result.Waiting
    }
}

/** A gap in time is worth marking; a timestamp on every message is just noise. */
object TranscriptLayout {
    /** iOS: `messages[i].at - messages[i - 1].at > 30 * 60 * 1000`. */
    const val GAP_MILLIS: Double = 30.0 * 60.0 * 1000.0

    fun startsNewStretch(messages: List<Message>, index: Int): Boolean {
        if (index <= 0) return true
        if (index >= messages.size) return false
        return messages[index].at - messages[index - 1].at > GAP_MILLIS
    }
}

/**
 * Roster search. Local filtering always; the remote `GET /api/search` only past
 * two characters and after a 250ms quiet period (§10).
 */
object SearchPolicy {
    const val MIN_LENGTH: Int = 2
    const val DEBOUNCE_MILLIS: Long = 250L

    sealed interface Decision {
        /** Too short — drop any hits and stop showing the spinner. */
        data object Clear : Decision

        /** Long enough — spin, wait out the debounce, then ask the computer. */
        data class Remote(val query: String) : Decision
    }

    fun decide(raw: String): Decision =
        if (raw.trim().length >= MIN_LENGTH) Decision.Remote(raw) else Decision.Clear

    /** Local filter: name, role chip, preview — case-insensitive, like iOS. */
    fun matches(summary: ChatSummary, query: String): Boolean {
        if (query.isEmpty()) return true
        return summary.chat.name.contains(query, ignoreCase = true) ||
            summary.chat.subtitle.contains(query, ignoreCase = true) ||
            summary.preview.contains(query, ignoreCase = true)
    }

    fun filter(summaries: List<ChatSummary>, query: String): List<ChatSummary> =
        if (query.isEmpty()) summaries else summaries.filter { matches(it, query) }
}

/**
 * Which option on an approval card means "go ahead", and when the phone may
 * offer a standing grant.
 *
 * [allowChoice] is deliberately not the literal string "Allow": `options` is
 * whatever the harness sent, and it only falls back to `["Allow", "Deny"]` when
 * the provider event named no choices of its own — a card is free to say "Yes",
 * "Approve", "Allow once". The conventional label wins when it is present.
 * (`CardView` in `ios/App/ChatView.swift`.)
 *
 * The allow/deny *behavior* mapping itself lives in `:core`'s `Session.answer`
 * and is not repeated here; [alwaysAllowChoice] documents where that mapping
 * forces this screen to diverge from iOS.
 */
object ApprovalChoices {
    const val ALLOW = "Allow"

    fun isRefusal(option: String): Boolean = option.equals("Deny", ignoreCase = true)

    fun allowChoice(options: List<String>): String? =
        options.firstOrNull { it.equals(ALLOW, ignoreCase = true) }
            ?: options.firstOrNull { !isRefusal(it) }

    /**
     * What "Always allow this tool" answers with once the grant is written, or
     * null when the phone cannot honour it coherently.
     *
     * This is a **deliberate divergence from iOS**, and the reason is a defect
     * there. `ios/App/ChatView.swift` answers with [allowChoice], and
     * `Session.answer` maps a permission card's choice to `allow` only when the
     * string is literally "allow". So a card offering `Approve / Deny` — which is
     * a shape the harness allows, since `options` is whatever the provider event
     * named — writes the standing grant and then sends `behavior: "deny"`: the
     * bot stays stopped, now with a permission it was never given the chance to
     * use. A card whose only option is `Deny` hides the button entirely, even
     * though `behavior: "allow"` was available the whole time.
     *
     * The briefing's wording is the coherent one: uses the card's key, **then
     * answers Allow**. For a permission card `Session.answer` sends
     * `{behavior}` and no message, so the choice string never reaches the
     * harness — only its allow/deny classification does. Preferring the card's
     * own wording when it has an allow-shaped literal keeps the ordinary card
     * behaving exactly as before.
     *
     * A question card is different: there the literal *is* the answer, so only
     * one of the card's own options may be sent, and the phone still invents
     * nothing.
     */
    fun alwaysAllowChoice(card: OptionCard): String? = when {
        !card.isPending || card.allowKey == null -> null
        card.isPermission -> card.options.firstOrNull { it.equals(ALLOW, ignoreCase = true) } ?: ALLOW
        else -> allowChoice(card.options)
    }

    /**
     * "Always allow this tool" needs a key the card itself carried and a bot to
     * hang it on — the phone never invents a grant, and rooms never show one
     * (§12).
     */
    fun showsAlwaysAllow(card: OptionCard, chat: Chat): Boolean =
        chat is Chat.BotChat && alwaysAllowChoice(card) != null
}

/** Reactions, grouped for display. `by == "user"` is yours. */
data class ReactionGroup(val emoji: String, val count: Int, val mine: Boolean)

object Reactions {
    val CHOICES: List<String> = listOf("👍", "❤️", "😂", "🎉", "👀")

    fun group(reactions: List<Reaction>): List<ReactionGroup> =
        reactions.groupBy { it.emoji }
            .map { (emoji, all) -> ReactionGroup(emoji, all.size, all.any { it.by == "user" }) }
            .sortedBy { it.emoji }
}
