package com.openmausbot.companion.core

import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DecodingTest {
    @Test
    fun decodesThePagedFleet() {
        val fleet = decodeFixture<Fleet>("bots-paged")
        assertTrue(fleet.bots.isNotEmpty())
        val bot = fleet.bots.first()
        assertTrue(bot.id.isNotEmpty())
        assertTrue(bot.threadId.isNotEmpty())
        assertTrue(bot.name.isNotEmpty())
        assertNotNull(bot.messages)
        val room = fleet.groups.first()
        assertEquals(3, room.messages?.size)
        assertEquals(true, room.hasMore)
    }

    @Test
    fun decodesTheFullFleetToo() {
        val fleet = decodeFixture<Fleet>("bots-full")
        assertTrue(fleet.bots.isNotEmpty())
        assertNull(fleet.bots.first().hasMore)
    }

    @Test
    fun decodesTheCloudBackendAndItsAbsence() {
        val fleet = CompanionJson.decodeFromString<Fleet>(
            """{"bots":[
              {"id":"b1","threadId":"t1","name":"Scout","title":"","description":"","notifications":true,"color":"green","unread":false,"modelSelection":{"instanceId":"i1","model":"m1"},"createdAt":1,"computer":"cloud","cloudBackend":"vps"},
              {"id":"b2","threadId":"t2","name":"Rio","title":"","description":"","notifications":true,"color":"blue","unread":false,"modelSelection":{"instanceId":"i1","model":"m1"},"createdAt":2,"computer":"cloud"}
            ],"groups":[]}""",
        )
        assertEquals("vps", fleet.bots.first().cloudBackend)
        assertNull(fleet.bots.last().cloudBackend)
    }

    @Test
    fun oneMalformedBotOrRoomDoesNotHideTheRestOfTheFleet() {
        val fleet = CompanionJson.decodeFromString<Fleet>(
            """{"bots":[
              {"id":"broken","threadId":42},
              {"id":"good","threadId":"t1","name":"Scout","title":"","description":"","notifications":true,"color":"green","unread":false,"modelSelection":{"instanceId":"i1","model":"m1"},"createdAt":1}
            ],"groups":[
              {"id":"broken-room","threadId":42},
              {"id":"good-room","threadId":"rt1","name":"Room","memberIds":[],"defaultResponder":{"kind":"mentions"},"bulletin":"","unread":false,"createdAt":1}
            ]}""",
        )
        assertEquals(listOf("good"), fleet.bots.map(Bot::id))
        assertEquals(listOf("good-room"), fleet.groups.map(Room::id))
    }

    @Test
    fun neverDecodesProviderSessionCursors() {
        listOf("bots-full", "bots-paged", "sse-frames").forEach { name ->
            assertFalse("resumeCursors" in fixtureText(name), "$name carries provider session cursors")
        }
    }

    @Test
    fun decodesAThreadPage() {
        val page = decodeFixture<ThreadPage>("thread-page")
        assertEquals(2, page.messages.size)
        assertEquals(true, page.hasMore)
        assertEquals(page.messages.map(Message::at).sorted(), page.messages.map(Message::at))
    }

    @Test
    fun decodesAnOptionsCard() {
        val message = decodeFixture<Message>("options-card")
        assertEquals(Message.Kind.OPTIONS, message.kind)
        assertEquals(Message.Role.BOT, message.role)
        val card = assertNotNull(message.card)
        assertTrue(card.options.isNotEmpty())
        assertFalse(card.isPending)
        assertFalse(card.isPermission)
    }

    @Test
    fun pendingApprovalIsActionableAndAnsweredOrDismissedIsNot() {
        val message = CompanionJson.decodeFromString<Message>(
            """{"id":"m1","role":"bot","kind":"options","at":1786742413762,
              "card":{"title":"Approval needed","subtitle":"rm -rf ./build","options":["Allow","Deny"],"requestId":"req-1","tool":"Bash","allowKey":"Bash:rm"}}""",
        )
        val card = assertNotNull(message.card)
        assertTrue(card.isPending)
        assertTrue(card.isPermission)
        assertEquals("Bash:rm", card.allowKey)
        assertFalse(card.copy(answered = "Allow").isPending)
        assertFalse(card.copy(dismissed = true).isPending)
    }

    @Test
    fun decodesAMessageThatGainedAnUnknownField() {
        val message = CompanionJson.decodeFromString<Message>(
            """{"id":"m2","role":"user","kind":"text","at":1,"text":"hi","somethingNew":{"a":1}}""",
        )
        assertEquals("hi", message.text)
    }

    @Test
    fun decodesThePairResponse() {
        val paired = decodeFixture<PairResponse>("pair-response")
        assertTrue(paired.token.startsWith("omb_"))
        assertEquals("Ada's iPhone", paired.device.name)
        assertTrue(paired.serverName.isNotEmpty())
    }

    @Test
    fun decodesTheHarnessErrorBodies() {
        assertTrue(decodeFixture<APIErrorBody>("unauthorized").error.contains("pair"))
        assertTrue(decodeFixture<APIErrorBody>("forbidden").error.isNotEmpty())
        assertTrue(decodeFixture<APIErrorBody>("pair-rejected").error.isNotEmpty())
    }

    @Test
    fun decodesInstancesAndConfig() {
        val instance = decodeFixture<InstanceList>("instances").instances.first()
        assertTrue(instance.instanceId.isNotEmpty())
        assertTrue(instance.driverKind.isNotEmpty())
        val config = decodeFixture<ConfigStatus>("config")
        assertEquals("Ada Lovelace", config.profile?.name)
        assertEquals(false, config.box?.configured)
    }

    @Test
    fun decodesEveryCapturedFrame() {
        val frames = decodeFixture<List<StreamFrame>>("sse-frames")
        assertTrue(frames.isNotEmpty())
        val kinds = frames.map { streamFrame ->
            when (val frame = streamFrame.frame) {
                is Frame.Hello -> {
                    assertTrue(':' in frame.cursor)
                    assertFalse(frame.resumed)
                    assertNull(streamFrame.seq)
                    "hello"
                }
                is Frame.Message -> {
                    assertTrue(frame.threadId.isNotEmpty())
                    assertTrue(frame.message.id.isNotEmpty())
                    assertNotNull(streamFrame.seq)
                    "message"
                }
                is Frame.Bot -> {
                    assertTrue(frame.bot.id.isNotEmpty())
                    assertNull(frame.bot.messages)
                    "bot"
                }
                is Frame.Unknown -> error("unhandled frame kind in fixtures: ${frame.kind}")
                else -> "other"
            }
        }
        assertTrue("hello" in kinds)
        assertTrue("message" in kinds)
        assertTrue("bot" in kinds)
    }

    @Test
    fun unknownFrameKindIsAbsorbedRatherThanThrown() {
        val stream = CompanionJson.decodeFromString<StreamFrame>(
            """{"kind":"routine.run","run":{"id":"r1"},"seq":9}""",
        )
        assertEquals(9, stream.seq)
        assertEquals(Frame.Unknown("routine.run"), stream.frame)
    }

    @Test
    fun decodesANotifyFrame() {
        val stream = CompanionJson.decodeFromString<StreamFrame>(
            """{"kind":"notify","seq":12,"notification":{"kind":"approval","botId":"b1","botName":"Scout","threadId":"t1","title":"Scout needs approval","body":"rm -rf ./build"}}""",
        )
        val notification = (stream.frame as Frame.Notify).notification
        assertTrue(notification.isBlocking)
        assertEquals("t1", notification.threadId)
        assertEquals("t1", stream.frame.threadId)
    }

    @Test
    fun unknownMessageKindDecodesAndKeepsItsText() {
        val message = CompanionJson.decodeFromString<Message>(
            """{"id":"m1","role":"bot","kind":"webhook","at":1,"text":"Stripe fired"}""",
        )
        assertEquals(Message.Kind.UNKNOWN, message.kind)
        assertEquals("Stripe fired", message.text)
    }

    @Test
    fun unknownRoleIsNotAttributedToTheUser() {
        val message = CompanionJson.decodeFromString<Message>(
            """{"id":"m1","role":"system","kind":"text","at":1,"text":"hello"}""",
        )
        assertEquals(Message.Role.BOT, message.role)
    }

    @Test
    fun oneUnknownMessageDoesNotSinkThePage() {
        val page = CompanionJson.decodeFromString<ThreadPage>(
            """{"messages":[
              {"id":"m1","role":"user","kind":"text","at":1,"text":"go"},
              {"id":"m2","role":"bot","kind":"something-new","at":2,"text":"working"},
              {"id":"m3","role":"bot","kind":"text","at":3,"text":"done"}
            ],"hasMore":false}""",
        )
        assertEquals(listOf(Message.Kind.TEXT, Message.Kind.UNKNOWN, Message.Kind.TEXT), page.messages.map(Message::kind))
        assertEquals(listOf("m1", "m2", "m3"), page.messages.map(Message::id))
    }

    @Test
    fun unknownMessageArrivesOverTheStream() {
        val frame = CompanionJson.decodeFromString<StreamFrame>(
            """{"kind":"message","seq":3,"threadId":"t1","message":{"id":"m9","role":"bot","kind":"routine.run","at":9,"text":"ran"}}""",
        ).frame as Frame.Message
        assertEquals("t1", frame.threadId)
        assertEquals(Message.Kind.UNKNOWN, frame.message.kind)
        assertEquals("ran", frame.message.text)
    }

    @Test
    fun messageKindRemainsRequired() {
        assertFailsWith<SerializationException> {
            CompanionJson.decodeFromString<Message>(
                """{"id":"m1","role":"bot","at":1,"text":"missing discriminator"}""",
            )
        }
    }
}
