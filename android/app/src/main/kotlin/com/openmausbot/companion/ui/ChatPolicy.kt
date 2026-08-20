package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChatSummary
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.PendingApproval
import com.openmausbot.companion.core.Reaction
import com.openmausbot.companion.core.Room
import com.openmausbot.companion.core.Session

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

    /**
     * True when the next message is from someone else (or there is none), which is
     * where a run of bubbles gets its tail — one per run, like every messaging app,
     * rather than one per bubble. The port of `endsRun` in `ios/App/ChatView.swift`.
     *
     * The three ways a run breaks, in the Swift's order: the role changes, the
     * speaker's name changes, or the next row is not text — a card or a tool chip
     * between two texts breaks the run visually. What this message itself is is
     * deliberately not asked: only [TextBubble] draws a tail, so an activity chip
     * that is followed by more text costs the run nothing.
     */
    fun endsRun(messages: List<Message>, index: Int): Boolean {
        val next = messages.getOrNull(index + 1) ?: return true
        val current = messages.getOrNull(index) ?: return true
        if (current.role != next.role) return true
        if (current.from?.name != next.from?.name) return true
        return next.kind != Message.Kind.TEXT
    }

    /** Which side the tail hangs from, or none while the run continues. */
    fun tail(message: Message, endsRun: Boolean): BubbleTail = when {
        !endsRun -> BubbleTail.NONE
        message.role == Message.Role.USER -> BubbleTail.TRAILING
        else -> BubbleTail.LEADING
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
 * Everything the chat's name pill and the composer's + can do — the port of
 * `chatActions` and `plusActions` in `ios/App/ChatView.swift`.
 *
 * One list, two doors: the pill for "about this chat", the + for "do something".
 * Tasks and the computer are bot ideas, and a room has neither (§12); only a
 * running bot can be interrupted. Exporting is not a bot idea — a room has a
 * transcript like anything else, so both doors offer it for every chat.
 */
enum class ChatActionId { NEW_TASK, TASKS, WATCH_COMPUTER, SHARE_MARKDOWN, SHARE_JSON, INTERRUPT }

data class ChatAction(
    val id: ChatActionId,
    val title: String,
    /** The line under the title. The pill's menu has no room for it; the sheet does. */
    val subtitle: String,
    val destructive: Boolean = false,
    val enabled: Boolean = true,
)

object ChatActions {
    /**
     * What the + opens. iOS offers Markdown only here and both formats in the
     * pill's menu, so neither door loses an export.
     */
    fun sheet(chat: Chat): List<ChatAction> {
        val bot = (chat as? Chat.BotChat)?.bot
        val out = mutableListOf<ChatAction>()
        if (bot != null) {
            out += ChatAction(
                id = ChatActionId.NEW_TASK,
                title = "New task",
                subtitle = "Start a fresh thread with ${bot.name}",
                enabled = bot.busy != true,
            )
            out += ChatAction(
                id = ChatActionId.TASKS,
                title = "Tasks",
                subtitle = "Switch, rename or remove one",
            )
            out += ChatAction(
                id = ChatActionId.WATCH_COMPUTER,
                title = "Watch computer",
                subtitle = "Live view of what ${bot.name} is doing",
            )
        }
        out += ChatAction(
            id = ChatActionId.SHARE_MARKDOWN,
            title = "Share transcript",
            subtitle = "This chat as Markdown",
        )
        if (chat.busy && bot != null) {
            out += ChatAction(
                id = ChatActionId.INTERRUPT,
                title = "Interrupt",
                subtitle = "Stop the current turn",
                destructive = true,
            )
        }
        return out
    }

    /**
     * What the name pill opens. The same actions with both export formats and no
     * sublines — a dropdown row is one line.
     *
     * Tasks carries no busy gate, exactly as the Swift menu does not: the sheet
     * behind it gates create, delete and switch itself ([TaskRules]), and renaming
     * is deliberately allowed mid-turn ([TaskDialogRules.renameEnabled]) — a gate
     * on the door made that unreachable.
     */
    fun menu(chat: Chat): List<ChatAction> {
        val bot = (chat as? Chat.BotChat)?.bot
        val out = mutableListOf<ChatAction>()
        if (bot != null) {
            out += ChatAction(
                id = ChatActionId.NEW_TASK,
                title = "New task",
                subtitle = "",
                enabled = bot.busy != true,
            )
            out += ChatAction(id = ChatActionId.TASKS, title = "Tasks", subtitle = "")
            out += ChatAction(
                id = ChatActionId.WATCH_COMPUTER,
                title = "Watch computer",
                subtitle = "",
            )
        }
        out += ChatAction(
            id = ChatActionId.SHARE_MARKDOWN,
            title = ShareFormat.MARKDOWN.label,
            subtitle = "",
        )
        out += ChatAction(id = ChatActionId.SHARE_JSON, title = ShareFormat.JSON.label, subtitle = "")
        if (chat.busy && bot != null) {
            out += ChatAction(
                id = ChatActionId.INTERRUPT,
                title = "Interrupt",
                subtitle = "",
                destructive = true,
            )
        }
        return out
    }
}

/**
 * How the roster arranges itself — the port of `ios/App/ChatListView.swift`.
 *
 * Messages-shaped: your groups across the top, every bot below, and a floating
 * bar at the bottom whose pill is Updates. Which chats are rows and which are
 * tiles is decided here rather than in the composable, because it is a rule and
 * not a layout.
 */
object RosterLayout {
    /** iOS: rooms live in the strip, so an unsearched roster lists only bots. */
    fun rows(summaries: List<ChatSummary>, query: String): List<ChatSummary> =
        if (query.isEmpty()) {
            summaries.filter { it.chat is Chat.BotChat }
        } else {
            SearchPolicy.filter(summaries, query)
        }

    /** The strip is part of the roster, not of a search result. */
    fun showsGroups(query: String): Boolean = query.isEmpty()

    /**
     * The chats a pending approval is waiting in — what puts "Waiting on you" on a
     * row. [pending] is passed in because [CompanionState.pendingApprovals] walks
     * every thread's transcript and the screen already holds the answer.
     */
    fun waitingChats(state: CompanionState, pending: List<PendingApproval>): Set<String> =
        pending.mapNotNullTo(mutableSetOf()) {
            ThreadResolution.chatOrNull(state, it.threadId)?.id
        }

    /** The first two of these are the faces a group tile stacks. */
    fun memberColors(state: CompanionState, room: Room): List<String> =
        room.memberIds.mapNotNull { state.bot(it)?.color }

    /** The header's second line: who this phone is paired with, and how it is doing. */
    fun headerSubtitle(connectionName: String?, status: Session.Status): String {
        val name = connectionName ?: NOT_PAIRED
        return when (status) {
            Session.Status.Live -> "$name · connected"
            Session.Status.Connecting -> "$name · connecting…"
            is Session.Status.Offline -> "$name · offline"
            Session.Status.Unauthorized -> "$name · unpaired"
            // The one branch that drops the name: unpaired has no computer to name.
            Session.Status.Unpaired -> NOT_PAIRED
        }
    }

    /**
     * A section heading. Uppercased by the invariant rules, which is what Swift's
     * `uppercased()` does — a reader in `tr-TR` must still read BOTS, not BOTS
     * spelled with a dotted capital.
     */
    fun sectionLabel(text: String): String = text.uppercase()

    private const val NOT_PAIRED = "Not paired"
}

/**
 * The floating bar's two faces: Updates beside the two round actions, or the
 * search field beside Cancel (`bottomBar` in `ios/App/ChatListView.swift`).
 *
 * Cancel takes the query with it, which is what returns the list to bots-only and
 * puts the groups strip back — so the two are one state, not two.
 */
data class RosterBar(val searchOpen: Boolean = false, val query: String = "") {
    fun openSearch(): RosterBar = copy(searchOpen = true)

    fun cancelSearch(): RosterBar = RosterBar(searchOpen = false, query = "")

    fun typed(text: String): RosterBar = copy(query = text)

    /** iOS clears the field without closing it; Cancel is what closes it. */
    fun clearQuery(): RosterBar = copy(query = "")
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
/** How much visual weight an approval option carries. */
enum class OptionEmphasis {
    /** The accented, filled button — anything that lets the bot continue. */
    PRIMARY,

    /** Quieter, for the refusal. */
    SECONDARY,
}

object ApprovalChoices {
    const val ALLOW = "Allow"

    fun isRefusal(option: String): Boolean = option.equals("Deny", ignoreCase = true)

    /**
     * The same `isRefusal` that picks the allow choice also picks the styling, so
     * the two cannot drift: whatever the card calls its refusal is the one option
     * that does not get accent weight (`ios/App/ChatView.swift` tints it
     * `Color.secondary` against `Color.accentColor` for the rest).
     */
    fun emphasis(option: String): OptionEmphasis =
        if (isRefusal(option)) OptionEmphasis.SECONDARY else OptionEmphasis.PRIMARY

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

/**
 * What a search hit shows about who said it — `ios/App/ChatListView.swift` puts a
 * person glyph on a user hit and a speech bubble on a bot one, so two hits with
 * the same words are still told apart.
 */
object SearchHitRole {
    fun isFromUser(role: Message.Role): Boolean = role == Message.Role.USER

    /** The glyph carries meaning, so it carries a description too. */
    fun contentDescription(role: Message.Role, name: String): String =
        if (isFromUser(role)) "Your message" else "Message from $name"
}

/**
 * What a message offers the clipboard.
 *
 * Selection covers the settled bubbles, but a gesture can only belong to one
 * owner: where text selection claims the long press, the reactions menu does
 * not open, and where the menu opens, selection did not start. A Copy action in
 * that menu makes the outcome the same either way, which is the point — the
 * reader wants the command, the URL or the approval detail, not a particular
 * gesture.
 */
object MessageActions {
    /** The text worth putting on the clipboard, or null when there is none. */
    fun copyableText(message: Message): String? = when (message.kind) {
        Message.Kind.TEXT, Message.Kind.UNKNOWN -> message.text?.takeIf { it.isNotBlank() }
        // An approval card is worth copying for what it is asking to do.
        Message.Kind.OPTIONS -> message.card
            ?.let { card -> listOf(card.title, card.subtitle).filter { it.isNotBlank() } }
            ?.takeIf { it.isNotEmpty() }
            ?.joinToString("\n\n")
        // A tool chip is context, and a screenshot is pixels.
        Message.Kind.ACTIVITY, Message.Kind.SCREEN -> null
    }
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
