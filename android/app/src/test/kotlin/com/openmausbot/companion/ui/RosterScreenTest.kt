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

/**
 * The home list, mounted for real: RosterScreen over a real Session, the
 * synthetic [RosterFixture] fleet and a disposable loopback server. No
 * pairing, device or user data is involved.
 *
 * The list starts under the header and its last row scrolls clear of the
 * floating bottom bar, whatever that bar measures.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w411dp-h914dp-mdpi")
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
    fun `the list starts under the header and its last row scrolls clear of the bar`() {
        // Twice the text size is where the bar grows past any fixed guess.
        mount(fontScale = 2f)
        val header = compose.onNodeWithTag("roster-header").getBoundsInRoot()
        val firstTitle = compose.onNodeWithText("NEEDS ATTENTION").getBoundsInRoot()
        assertTrue(firstTitle.top >= header.bottom, "the first title starts under the header")

        toEnd()
        val bar = compose.onNodeWithTag("roster-bottom-bar").getBoundsInRoot()
        // the last target is the Threads row under the last bot
        val lastRow = "threads-toggle.${RosterFixture.LAST_ROW}"
        val last = compose.onNodeWithTag(lastRow).assertIsDisplayed().getBoundsInRoot()
        assertTrue(last.bottom <= bar.top, "the last row ends at ${last.bottom}, under the bar at ${bar.top}")

        // and a tap there reaches the row, not the bar
        compose.onNodeWithTag(lastRow).performClick()
        compose.onNodeWithTag(lastRow).assert(hasStateDescription("Expanded, 1 threads"))
    }

    private fun list(): SemanticsNodeInteraction = compose.onNodeWithTag("roster-list")

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
