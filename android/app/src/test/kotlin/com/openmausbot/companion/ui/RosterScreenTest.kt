package com.openmausbot.companion.ui

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasStateDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotTask
import com.openmausbot.companion.core.ChatTarget
import com.openmausbot.companion.core.CompanionJson
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.Frame
import com.openmausbot.companion.core.RosterDensity
import com.openmausbot.companion.core.RosterRowStatus
import com.openmausbot.companion.core.StreamFrame
import com.openmausbot.companion.core.rosterStatus
import com.openmausbot.companion.core.rosterThreadCount
import com.openmausbot.companion.storage.ChatPreferences
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.flow
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The compact home list and its setting, mounted for real: RosterScreen and
 * SettingsScreen over a real Session, the synthetic [RosterFixture] fleet and a
 * disposable loopback server. No pairing, device or user data is involved.
 *
 * Compact is the default. A bot is one line; only a bot with two or more
 * threads carries "› N", which lists them in line with its name and ends in
 * New thread; a single-thread bot gets New thread from a long press. Settings
 * → List density switches back to comfortable. In both densities the list
 * starts under the header and its last row scrolls clear of the bottom bar.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w411dp-h914dp-mdpi")
// Real text measurement: the rows' heights, wraps and truncation are the point.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@OptIn(ExperimentalTestApi::class)
class RosterScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>(
        // The avatars and spinners request frames; the reduced-motion path lets
        // the clock reach idle, as in the other roster wiring tests.
        effectContext = object : MotionDurationScale { override val scaleFactor = 0f },
    )

    private val context: Context = RuntimeEnvironment.getApplication()
    private lateinit var server: MockWebServer
    private lateinit var scene: WiringScene
    private val requests = ConcurrentLinkedQueue<RecordedRequest>()
    private var answerCreate: (RecordedRequest) -> MockResponse = { MockResponse().setResponseCode(503) }

    @Before
    fun startServer() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests.add(request)
                return when {
                    request.method == "POST" && request.path == "/api/bots/${RosterFixture.CHIEF}/tasks" ->
                        answerCreate(request)
                    request.path?.startsWith("/api/search") == true -> json("""{"hits":[]}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
    }

    @After
    fun stopServer() {
        if (::scene.isInitialized) scene.session.disconnect()
        server.shutdown()
    }

    @Test
    fun `the fixture covers every state the compact list draws`() {
        val state = CompanionState().hydrate(RosterFixture.fleet())
        val queued = state.queuedThreadIds
        fun bot(id: String): Bot = checkNotNull(state.bot(id)) { "fixture lost $id" }

        assertEquals(RosterFixture.CHIEF, state.unsectionedChief?.id)
        assertEquals(1, bot(RosterFixture.CHIEF).rosterThreadCount(queued))
        assertEquals(3, bot(RosterFixture.THREE_THREADS).rosterThreadCount(queued))
        assertEquals(2, bot(RosterFixture.TWO_THREADS).rosterThreadCount(queued))
        assertEquals(RosterRowStatus.WAITING_ON_YOU, bot(RosterFixture.WAITING).rosterStatus(hasPendingCard = false))
        assertEquals(RosterRowStatus.WORKING, bot(RosterFixture.WORKING).rosterStatus(hasPendingCard = false))
        assertEquals(listOf(RosterFixture.PINNED), state.pinnedBots.map { it.id })
        assertEquals(listOf(RosterFixture.GROUP, "roster-design-crit"), state.unsectionedChannels.map { it.id })
        assertEquals(listOf(RosterFixture.BOT_CHAT), state.botChats.map { it.id })
        assertTrue(state.sidebarSections.any { it.chiefs.isNotEmpty() && it.channels.isNotEmpty() })
        assertEquals(RosterFixture.LAST_ROW, state.sidebarSections.last().bots.last().id)
        assertTrue("roster-pepper-weekend" in queued)
        // No pending card: the waiting marks come from the threads themselves.
        assertTrue(state.pendingApprovals.isEmpty())
    }

    @Test
    fun `compact is the default, one line per bot with no Threads row`() {
        val navigator = mount()
        assertEquals(RosterDensity.COMPACT, scene.environment.chatPreferences.rosterDensity.value)

        val chief = compose.onNodeWithTag("chat-row.${RosterFixture.CHIEF}")
            .assertIsDisplayed()
            .assert(hasText("Atlas"))
            .assert(hasText("Operations lead"))
            .assert(hasContentDescription("Chief of Staff"))
        // One line: the preview is gone, the row keeps Android's touch height.
        assertEquals(MIN_TOUCH_TARGET, chief.getBoundsInRoot().let { it.bottom - it.top })
        compose.onNodeWithText("Three reviews and one approval. I put them in order.").assertDoesNotExist()
        // A single thread is the bot itself: no "Threads 1" row and no count.
        compose.onNodeWithTag("threads-toggle.${RosterFixture.CHIEF}").assertDoesNotExist()
        compose.onNodeWithTag("chat-row.${RosterFixture.PINNED}").assert(!hasContentDescription("Chief of Staff"))

        chief.performClick()
        assertEquals(Destination.Chat(ChatTarget.Bot(RosterFixture.CHIEF, "roster-atlas-plan")), navigator.current)
    }

    @Test
    fun `status is a small mark, a hand while waiting and a spinner in place of the time while working`() {
        mount()
        reveal("chat-row.${RosterFixture.WAITING}")
        compose.onNodeWithTag("chat-row.${RosterFixture.WAITING}")
            .assert(hasContentDescription("Waiting on you"))
            .assert(hasText(stamp("roster-scout-checklist")))
            // no chip: the words are for TalkBack, the screen shows the hand
            .assert(!hasText("Waiting on you"))

        reveal("chat-row.${RosterFixture.WORKING}")
        compose.onNodeWithTag("chat-row.${RosterFixture.WORKING}")
            .assert(hasContentDescription("Working"))
            .assert(!hasText(stamp("roster-forge-release")))
    }

    @Test
    fun `a single-thread bot still starts a new thread from a long press`() {
        val atlas = RosterFixture.fleet().bots.first { it.id == RosterFixture.CHIEF }
        val created = atlas.copy(
            threadId = "roster-atlas-new",
            tasks = atlas.tasks.orEmpty() + BotTask(threadId = "roster-atlas-new", title = "", createdAt = 2.0),
            messages = emptyList(),
        )
        answerCreate = { json("""{"bot":${CompanionJson.encodeToString(Bot.serializer(), created)}}""") }
        val navigator = mount()

        val chief = compose.onNodeWithTag("chat-row.${RosterFixture.CHIEF}")
        // TalkBack reaches both without the gesture.
        chief.assert(customActions("New thread", "Manage threads"))
        chief.performTouchInput { longClick() }
        compose.onNodeWithText("Manage threads").assertIsDisplayed()
        compose.onNodeWithText("New thread").performClick()

        compose.waitUntil(5_000) {
            (navigator.current as? Destination.Chat)?.target == ChatTarget.Bot(RosterFixture.CHIEF, "roster-atlas-new")
        }
        assertEquals(1, requests.count { it.method == "POST" && it.path == "/api/bots/${RosterFixture.CHIEF}/tasks" })
    }

    @Test
    fun `Manage threads from the long press opens the bot's thread sheet`() {
        mount()
        compose.onNodeWithTag("chat-row.${RosterFixture.CHIEF}").performTouchInput { longClick() }
        compose.onNodeWithText("Manage threads").performClick()
        compose.onNodeWithText("Atlas's threads").assertIsDisplayed()
    }

    @Test
    fun `a multi-thread bot's count lists its threads in line with its name, then New thread`() {
        val navigator = mount()
        reveal("chat-row.${RosterFixture.THREE_THREADS}")
        val toggle = compose.onNodeWithTag("threads-toggle.${RosterFixture.THREE_THREADS}")
            .assertIsDisplayed()
            .assert(hasText("3"))
            .assert(hasContentDescription("Pepper's threads"))
            .assert(hasStateDescription("Collapsed, 3 threads"))
        RosterFixture.PEPPER_THREADS.forEach { compose.onNodeWithTag("thread.$it").assertDoesNotExist() }
        compose.onNodeWithTag("new-thread.${RosterFixture.THREE_THREADS}").assertDoesNotExist()

        toggle.performClick()
        toggle.assert(hasStateDescription("Expanded, 3 threads"))
        val nameLeft = compose.onNode(
            hasText("Pepper") and hasAnyAncestor(hasTestTag("chat-row.${RosterFixture.THREE_THREADS}")),
            useUnmergedTree = true,
        ).getBoundsInRoot().left
        RosterFixture.PEPPER_THREADS.forEach { threadId ->
            reveal("thread.$threadId")
            val line = compose.onNodeWithTag("thread.$threadId").assertIsDisplayed().getBoundsInRoot()
            assertEquals(nameLeft, line.left, "$threadId starts where the bot's name does")
        }
        // the routine run stays out of the list, as it stays out of the count
        compose.onNodeWithTag("thread.roster-pepper-routine").assertDoesNotExist()
        reveal("new-thread.${RosterFixture.THREE_THREADS}")
        compose.onNodeWithTag("new-thread.${RosterFixture.THREE_THREADS}")
            .assertIsDisplayed()
            .assert(hasText("New thread"))
            .assert(hasContentDescription("New thread with Pepper"))

        reveal("thread.roster-pepper-icloud").performClick()
        assertEquals(
            Destination.Chat(ChatTarget.Bot(RosterFixture.THREE_THREADS, "roster-pepper-icloud")),
            navigator.current,
        )
    }

    @Test
    fun `a search lists matching threads under their bots, without New thread`() {
        mount()
        compose.onNodeWithContentDescription("Search").performClick()
        compose.onNode(hasSetTextAction()).performTextInput("Triage")
        compose.waitForIdle()

        compose.onNodeWithTag("thread.roster-pepper-gmail").assertExists()
        compose.onNodeWithTag("thread.roster-pepper-icloud").assertExists()
        compose.onNodeWithTag("thread.roster-pepper-weekend").assertDoesNotExist()
        compose.onNodeWithTag("new-thread.${RosterFixture.THREE_THREADS}").assertDoesNotExist()
        compose.onNodeWithTag("threads-toggle.${RosterFixture.THREE_THREADS}").assertIsNotEnabled()
    }

    @Test
    fun `groups are one-line rows, with New group on the Groups title`() {
        val navigator = mount()
        compose.onNodeWithTag("chat-row.${RosterFixture.GROUP}").assertIsDisplayed().assert(hasText("General"))
        // the strip's dashed tile is gone; its "+" moved onto the title
        compose.onNodeWithText("New group").assertDoesNotExist()
        compose.onNodeWithContentDescription("New group").assertIsDisplayed()
        reveal("chat-row.${RosterFixture.BOT_CHAT}")
        compose.onNodeWithTag("chat-row.${RosterFixture.BOT_CHAT}").assertIsDisplayed()
        reveal("chat-row.${RosterFixture.SECTION_GROUP}")
        compose.onNodeWithTag("chat-row.${RosterFixture.SECTION_GROUP}").assertIsDisplayed()

        // back to the top, where the row is clear of the floating bar
        list().performScrollToIndex(0)
        compose.onNodeWithTag("chat-row.${RosterFixture.GROUP}").performClick()
        assertEquals(Destination.Chat(ChatTarget.Room(RosterFixture.GROUP, "roster-general-thread")), navigator.current)
    }

    @Test
    fun `the plus on the Groups title starts a new group`() {
        mount()
        compose.onNodeWithContentDescription("New group").performClick()
        compose.onNodeWithText("Group name (optional)").assertIsDisplayed()
    }

    @Test
    fun `List density in Settings switches back to comfortable, and is remembered`() {
        mount()
        compose.onAllNodesWithContentDescription("Settings").onFirst().performClick()
        compose.onNodeWithText("List density").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Change list density").performScrollTo().performClick()
        compose.onNode(hasText("Compact") and isSelectable()).assertIsSelected()
        compose.onNode(hasText("Comfortable") and isSelectable()).performClick()

        assertEquals(RosterDensity.COMFORTABLE, scene.environment.chatPreferences.rosterDensity.value)
        assertEquals(RosterDensity.COMFORTABLE, ChatPreferences(context).rosterDensity.value)
        compose.onNodeWithText("Comfortable").performScrollTo().assertIsDisplayed()

        compose.onNodeWithContentDescription("Back").performClick()
        // Comfortable is the list as it was: the preview, and a Threads row under every bot.
        compose.onNodeWithText("Three reviews and one approval. I put them in order.").assertIsDisplayed()
        compose.onNodeWithTag("threads-toggle.${RosterFixture.CHIEF}").assertIsDisplayed()
    }

    @Test
    fun `in both densities the list starts under the header and its last row scrolls clear of the bar`() {
        // Twice the text size is where the bar grows past any fixed guess.
        val navigator = mount(fontScale = 2f)
        RosterDensity.entries.forEach { density ->
            compose.runOnIdle { scene.environment.chatPreferences.setRosterDensity(density) }
            compose.waitForIdle()
            list().performScrollToIndex(0)
            val header = compose.onNodeWithTag("roster-header").getBoundsInRoot()
            val firstTitle = compose.onNodeWithText("NEEDS ATTENTION").getBoundsInRoot()
            assertTrue(firstTitle.top >= header.bottom, "$density: the first title starts under the header")

            toEnd()
            val bar = compose.onNodeWithTag("roster-bottom-bar").getBoundsInRoot()
            val lastRow = when (density) {
                RosterDensity.COMPACT -> "chat-row.${RosterFixture.LAST_ROW}"
                // comfortable's last target is the Threads row under its last bot
                RosterDensity.COMFORTABLE -> "threads-toggle.${RosterFixture.LAST_ROW}"
            }
            val last = compose.onNodeWithTag(lastRow).assertIsDisplayed().getBoundsInRoot()
            assertTrue(last.bottom <= bar.top, "$density: the last row ends at ${last.bottom}, under the bar at ${bar.top}")

            // and a tap there reaches the row, not the bar
            compose.onNodeWithTag(lastRow).performClick()
            when (density) {
                RosterDensity.COMFORTABLE -> compose.onNodeWithTag(lastRow)
                    .assert(hasStateDescription("Expanded, 1 threads"))
                // last, because it leaves the list
                RosterDensity.COMPACT -> assertEquals(
                    Destination.Chat(ChatTarget.Bot(RosterFixture.LAST_ROW, "roster-sage-pricing")),
                    navigator.current,
                )
            }
        }
    }

    @Test
    fun `at twice the text size a long name wraps between words instead of breaking or truncating`() {
        mount(fontScale = 2f)
        reveal("chat-row.${RosterFixture.LONG_NAME}")
        val layout = textLayout(
            compose.onNode(
                hasText(RosterFixture.LONG_NAME_TEXT) and
                    hasAnyAncestor(hasTestTag("chat-row.${RosterFixture.LONG_NAME}")),
                useUnmergedTree = true,
            ),
        )
        assertTrue(layout.lineCount > 1, "the name should take more than one line at this size")
        assertFalse(layout.isLineEllipsized(layout.lineCount - 1), "the name should not be cut short")
        (0 until layout.lineCount - 1).forEach { line ->
            val last = RosterFixture.LONG_NAME_TEXT[layout.getLineEnd(line) - 1]
            assertTrue(last == ' ' || last == '-', "line $line of the name ends mid-word")
        }
    }

    private fun list(): SemanticsNodeInteraction = compose.onNodeWithTag("roster-list")

    /**
     * Scrolls [tag] into view and, when that leaves it under the floating bar,
     * on until a finger can reach it.
     */
    private fun reveal(tag: String): SemanticsNodeInteraction {
        list().performScrollToNode(hasTestTag(tag))
        compose.waitForIdle()
        val barTop = compose.onNodeWithTag("roster-bottom-bar").getBoundsInRoot().top
        val bottom = compose.onNodeWithTag(tag).getBoundsInRoot().bottom
        if (bottom > barTop) {
            val by = with(compose.density) { (bottom - barTop + 8.dp).toPx() }
            list().performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, by) }
            compose.waitForIdle()
        }
        return compose.onNodeWithTag(tag)
    }

    private fun toEnd() {
        repeat(3) {
            list().performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 100_000f) }
            compose.waitForIdle()
        }
    }

    /** The time a row shows for [threadId]'s last message, as the row words it. */
    private fun stamp(threadId: String): String {
        val at = scene.session.state.value.visibleTranscript(threadId).last().at
        return RelativeStamp.list(at, System.currentTimeMillis())
    }

    private fun customActions(vararg labels: String) = SemanticsMatcher("custom actions ${labels.toList()}") { node ->
        node.config.getOrNull(SemanticsActions.CustomActions)?.map { it.label } == labels.toList()
    }

    private fun textLayout(node: SemanticsNodeInteraction): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
        return results.single()
    }

    /**
     * The roster with Settings and a stand-in conversation behind the same
     * navigator, on a fresh install's preferences.
     */
    private fun mount(fontScale: Float = 1f): CompanionNavigator {
        context.getSharedPreferences(ChatPreferences.NAME, Context.MODE_PRIVATE).edit().clear().commit()
        val navigator = CompanionNavigator()
        scene = WiringScene(
            connection = Connection(id = "roster-fixture", name = "Offline fixture", host = "127.0.0.1", port = server.port),
            fleet = RosterFixture.fleet(),
            events = {
                flow {
                    emit(StreamFrame(Frame.Hello(cursor = "fixture:1", resumed = false), seq = 1))
                    awaitCancellation()
                }
            },
        )
        compose.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(
                LocalCompanion provides scene.environment,
                LocalDensity provides Density(base.density, fontScale),
            ) {
                CompanionTheme(darkTheme = false) {
                    Surface(Modifier.fillMaxSize()) {
                        val state by scene.session.state.collectAsState()
                        if (state.bots.isNotEmpty()) Screens(navigator)
                    }
                }
            }
        }
        compose.runOnIdle { scene.session.connect() }
        compose.waitUntil(5_000) { scene.session.state.value.bots.isNotEmpty() }
        compose.waitForIdle()
        return navigator
    }

    @Composable
    private fun Screens(navigator: CompanionNavigator) {
        when (navigator.current) {
            Destination.Roster -> RosterScreen(navigator)
            Destination.Settings -> SettingsScreen(onBack = navigator::pop)
            else -> Text("Conversation")
        }
    }

    private fun json(body: String): MockResponse = MockResponse()
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
