package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotTask
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.ChatSummary
import com.openmausbot.companion.core.GroupResponder
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.ModelSelection
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.Reaction
import com.openmausbot.companion.core.Room
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Regression for the cold-start notification tap: an empty pre-hydrate state is
 * "not yet", not "deleted". Concluding the latter popped the chat screen the
 * instant it opened, so the tap led back to the roster.
 */
class ThreadResolutionTest {
    private val hydratedEmpty = CompanionState(cursor = "stream-1:12")

    @Test
    fun `an empty state before the first hello is not an answer`() {
        assertEquals(
            ThreadResolution.Result.Waiting,
            ThreadResolution.resolve(CompanionState(), "thread-bot-1"),
        )
        assertNull(ThreadResolution.chatOrNull(CompanionState(), "thread-bot-1"))
    }

    @Test
    fun `a hydrated fleet without the thread means it is gone`() {
        assertEquals(
            ThreadResolution.Result.Gone,
            ThreadResolution.resolve(hydratedEmpty, "thread-bot-1"),
        )
    }

    @Test
    fun `a cursor is not the only proof of hydration`() {
        // A stream resumed from a cursor that was never committed still has bots.
        val withBots = CompanionState(bots = listOf(bot()))
        assertEquals(
            ThreadResolution.Result.Gone,
            ThreadResolution.resolve(withBots, "thread-missing"),
        )
        assertTrue(ThreadResolution.hydrated(withBots))
        assertFalse(ThreadResolution.hydrated(CompanionState()))
    }

    @Test
    fun `a known bot thread resolves to its chat`() {
        val state = CompanionState(bots = listOf(bot()), cursor = "stream-1:1")
        val resolved = ThreadResolution.resolve(state, "thread-bot-1")
        assertEquals(Chat.BotChat(bot()), (resolved as ThreadResolution.Result.Open).chat)
    }

    @Test
    fun `a task switch keeps the chat open, on the new task`() {
        val tasks = listOf(
            BotTask(threadId = "thread-bot-1", title = "First", createdAt = 0.0),
            BotTask(threadId = "thread-two", title = "Second", createdAt = 1.0),
        )
        // The chat was opened on the bot's first task.
        val before = CompanionState(bots = listOf(bot().copy(tasks = tasks)), cursor = "s:1")
        assertEquals(
            "thread-bot-1",
            ThreadResolution.chatOrNull(before, "thread-bot-1")?.threadId,
        )

        // Switching moves the bot to the second task; the destination still names
        // the first. The chat must follow the bot rather than pop to the roster.
        val after = CompanionState(
            bots = listOf(bot().copy(threadId = "thread-two", tasks = tasks)),
            cursor = "s:2",
        )
        val resolved = ThreadResolution.resolve(after, "thread-bot-1")
        assertTrue(resolved is ThreadResolution.Result.Open, "resolved to $resolved")
        assertEquals("thread-two", (resolved as ThreadResolution.Result.Open).chat.threadId)
        assertEquals("bot-1", resolved.chat.id)
    }

    @Test
    fun `a thread belonging to no bot's tasks is still gone`() {
        val state = CompanionState(
            bots = listOf(
                bot().copy(
                    tasks = listOf(BotTask("thread-bot-1", "First", 0.0)),
                ),
            ),
            cursor = "s:1",
        )
        assertEquals(ThreadResolution.Result.Gone, ThreadResolution.resolve(state, "thread-alien"))
    }

    @Test
    fun `the open thread wins over a task list that also contains it`() {
        // Two bots, one of which lists the other's thread — the live owner wins.
        val state = CompanionState(
            bots = listOf(
                bot(id = "bot-2").copy(
                    threadId = "thread-shared",
                    tasks = listOf(BotTask("thread-shared", "Mine", 0.0)),
                ),
                bot(id = "bot-1").copy(
                    threadId = "thread-elsewhere",
                    tasks = listOf(BotTask("thread-shared", "Stale", 0.0)),
                ),
            ),
            cursor = "s:1",
        )
        assertEquals("bot-2", ThreadResolution.chatOrNull(state, "thread-shared")?.id)
    }

    @Test
    fun `a known room thread resolves to its chat`() {
        val state = CompanionState(rooms = listOf(room()), cursor = "stream-1:1")
        assertEquals(
            Chat.RoomChat(room()),
            ThreadResolution.chatOrNull(state, "thread-room-1"),
        )
    }
}

class TranscriptLayoutTest {
    private fun message(id: String, at: Double) = Message(
        id = id,
        role = Message.Role.BOT,
        kind = Message.Kind.TEXT,
        at = at,
    )

    @Test
    fun `the first message always opens a stretch`() {
        assertTrue(TranscriptLayout.startsNewStretch(listOf(message("a", 0.0)), 0))
    }

    @Test
    fun `messages closer than thirty minutes share a stretch`() {
        val messages = listOf(message("a", 0.0), message("b", 29 * 60 * 1000.0))
        assertFalse(TranscriptLayout.startsNewStretch(messages, 1))
    }

    @Test
    fun `exactly thirty minutes is not yet a gap`() {
        val messages = listOf(message("a", 0.0), message("b", 30 * 60 * 1000.0))
        assertFalse(TranscriptLayout.startsNewStretch(messages, 1))
    }

    @Test
    fun `more than thirty minutes opens a new stretch`() {
        val messages = listOf(message("a", 0.0), message("b", 30 * 60 * 1000.0 + 1))
        assertTrue(TranscriptLayout.startsNewStretch(messages, 1))
    }

    @Test
    fun `an index past the end is not a stretch`() {
        assertFalse(TranscriptLayout.startsNewStretch(listOf(message("a", 0.0)), 4))
    }
}

class SearchPolicyTest {
    @Test
    fun `one character never reaches the computer`() {
        assertEquals(SearchPolicy.Decision.Clear, SearchPolicy.decide(""))
        assertEquals(SearchPolicy.Decision.Clear, SearchPolicy.decide("a"))
        assertEquals(SearchPolicy.Decision.Clear, SearchPolicy.decide("  a  "))
    }

    @Test
    fun `two characters do, and the raw query is what is sent`() {
        assertEquals(SearchPolicy.Decision.Remote("ab"), SearchPolicy.decide("ab"))
        assertEquals(SearchPolicy.Decision.Remote(" ab "), SearchPolicy.decide(" ab "))
    }

    @Test
    fun `the debounce matches the desktop`() {
        assertEquals(250L, SearchPolicy.DEBOUNCE_MILLIS)
        assertEquals(2, SearchPolicy.MIN_LENGTH)
    }

    @Test
    fun `local filtering looks at name, role chip and preview`() {
        val summary = summary(name = "Scout", title = "research", preview = "found the invoice")
        assertTrue(SearchPolicy.matches(summary, "sco"))
        assertTrue(SearchPolicy.matches(summary, "RESEARCH"))
        assertTrue(SearchPolicy.matches(summary, "invoice"))
        assertFalse(SearchPolicy.matches(summary, "zebra"))
    }

    @Test
    fun `an empty query keeps everything`() {
        val all = listOf(summary("Scout", "research", "x"), summary("Ada", "builds", "y"))
        assertEquals(all, SearchPolicy.filter(all, ""))
    }

    private fun summary(name: String, title: String, preview: String) = ChatSummary(
        chat = Chat.BotChat(bot(name = name, title = title)),
        preview = preview,
        lastActivity = 0.0,
        pinned = false,
    )
}

class ApprovalChoicesTest {
    @Test
    fun `the conventional label wins when the card offers it`() {
        assertEquals("Allow", ApprovalChoices.allowChoice(listOf("Allow", "Deny")))
        assertEquals("allow", ApprovalChoices.allowChoice(listOf("Deny", "allow")))
    }

    @Test
    fun `otherwise the first option that is not the refusal`() {
        assertEquals("Approve", ApprovalChoices.allowChoice(listOf("Approve", "Deny")))
        assertEquals("Yes", ApprovalChoices.allowChoice(listOf("Deny", "Yes", "Maybe")))
    }

    @Test
    fun `a card offering only a refusal has no allow choice`() {
        assertNull(ApprovalChoices.allowChoice(listOf("Deny")))
        assertNull(ApprovalChoices.allowChoice(emptyList()))
    }

    @Test
    fun `deny is the refusal, case-insensitively`() {
        assertTrue(ApprovalChoices.isRefusal("Deny"))
        assertTrue(ApprovalChoices.isRefusal("DENY"))
        assertFalse(ApprovalChoices.isRefusal("Decline"))
    }

    @Test
    fun `always allow needs a key from the card and a bot to hang it on`() {
        val withKey = card(allowKey = "shell:ls")
        val withoutKey = card(allowKey = null)
        assertTrue(ApprovalChoices.showsAlwaysAllow(withKey, Chat.BotChat(bot())))
        assertFalse(ApprovalChoices.showsAlwaysAllow(withoutKey, Chat.BotChat(bot())))
        // A room shows the card but never a standing grant (§12).
        assertFalse(ApprovalChoices.showsAlwaysAllow(withKey, Chat.RoomChat(room())))
    }

    @Test
    fun `an answered card offers no standing grant`() {
        val answered = card(allowKey = "shell:ls").copy(answered = "Allow")
        assertFalse(ApprovalChoices.showsAlwaysAllow(answered, Chat.BotChat(bot())))
        assertNull(ApprovalChoices.alwaysAllowChoice(answered))
    }

    // Regression: `Session.answer` maps a permission card's choice to `allow`
    // only when the string is literally "allow". Answering a standing grant with
    // anything else wrote the grant and then denied the request.

    @Test
    fun `always allow answers a permission card with an allow-behaving choice`() {
        for (options in listOf(
            listOf("Allow", "Deny"),
            listOf("Approve", "Deny"),
            listOf("Yes", "No"),
            listOf("Deny"),
            emptyList(),
        )) {
            val choice = ApprovalChoices.alwaysAllowChoice(
                card(allowKey = "shell:ls").copy(options = options),
            )
            assertTrue(
                choice != null && choice.equals("allow", ignoreCase = true),
                "options $options produced <$choice>, which Session.answer maps to deny",
            )
        }
    }

    @Test
    fun `a permission card whose own wording is Allow keeps that wording`() {
        assertEquals(
            "allow",
            ApprovalChoices.alwaysAllowChoice(
                card(allowKey = "shell:ls").copy(options = listOf("allow", "Deny")),
            ),
        )
    }

    @Test
    fun `a deny-only permission card still offers the standing grant`() {
        val denyOnly = card(allowKey = "shell:ls").copy(options = listOf("Deny"))
        assertTrue(ApprovalChoices.showsAlwaysAllow(denyOnly, Chat.BotChat(bot())))
    }

    @Test
    fun `a question card may only answer with one of its own options`() {
        val question = OptionCard(
            title = "Which branch?",
            subtitle = "",
            options = listOf("main", "Deny"),
            requestId = "req-1",
            tool = null,
            allowKey = "question:1",
        )
        assertEquals("main", ApprovalChoices.alwaysAllowChoice(question))
        assertNull(ApprovalChoices.alwaysAllowChoice(question.copy(options = listOf("Deny"))))
    }

    private fun card(allowKey: String?) = OptionCard(
        title = "Run a command",
        subtitle = "ls -la",
        options = listOf("Allow", "Deny"),
        requestId = "req-1",
        tool = "shell",
        allowKey = allowKey,
    )
}

class ReactionsTest {
    @Test
    fun `reactions group by emoji, sorted, with yours flagged`() {
        val grouped = Reactions.group(
            listOf(
                Reaction("👍", "user"),
                Reaction("👍", "bot-1"),
                Reaction("🎉", "bot-1"),
            ),
        )
        assertEquals(2, grouped.size)
        val thumbs = grouped.first { it.emoji == "👍" }
        assertEquals(2, thumbs.count)
        assertTrue(thumbs.mine)
        assertFalse(grouped.first { it.emoji == "🎉" }.mine)
    }

    @Test
    fun `the five choices match the desktop`() {
        assertEquals(listOf("👍", "❤️", "😂", "🎉", "👀"), Reactions.CHOICES)
    }
}

internal fun bot(
    id: String = "bot-1",
    name: String = "Scout",
    title: String = "research",
    busy: Boolean? = null,
) = Bot(
    id = id,
    threadId = "thread-$id",
    name = name,
    title = title,
    description = "",
    notifications = true,
    color = "green",
    unread = false,
    modelSelection = ModelSelection("instance-1", "model-1"),
    createdAt = 0.0,
    busy = busy,
)

internal fun room(id: String = "room-1") = Room(
    id = id,
    threadId = "thread-$id",
    name = "Standup",
    memberIds = listOf("bot-1", "bot-2"),
    defaultResponder = GroupResponder("auto"),
    bulletin = "",
    unread = false,
    createdAt = 0.0,
)
