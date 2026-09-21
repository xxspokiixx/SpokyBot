package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Mirrors CompanionCore's BrowserLiveDecoderTests. */
class BrowserLiveDecoderTest {
    @Test
    fun decodesAFrameWithItsDeviceSize() {
        val json = """{"type":"frame","seq":7,"data":"/9j/abc","format":"jpeg","metadata":{"deviceWidth":1280,"deviceHeight":720}}"""

        val frame = assertIs<BrowserLiveMessage.Frame>(BrowserLiveDecoder.message(json)).frame

        assertEquals(7, frame.seq)
        assertEquals("/9j/abc", frame.data)
        assertEquals("jpeg", frame.format)
        assertEquals(1280.0, frame.deviceWidth)
        assertEquals(720.0, frame.deviceHeight)
    }

    /** The viewport is what the sink denormalises against, so a status that
     * loses it would put every click in the wrong place. */
    @Test
    fun decodesStatusWithTheViewport() {
        val json = """{"type":"status","connected":true,"screencasting":true,"viewportWidth":1512,"viewportHeight":982}"""

        val status = assertIs<BrowserLiveMessage.Status>(BrowserLiveDecoder.message(json)).status

        assertTrue(status.connected)
        assertTrue(status.screencasting)
        assertEquals(1512.0, status.viewportWidth)
        assertEquals(982.0, status.viewportHeight)
    }

    @Test
    fun decodesUrlTabsAndViewerId() {
        assertEquals(
            "https://example.test/",
            assertIs<BrowserLiveMessage.Url>(
                BrowserLiveDecoder.message("""{"type":"url","url":"https://example.test/"}"""),
            ).url,
        )

        val tabsJson = """{"type":"tabs","tabs":[{"tabId":"t1","title":"One","url":"https://a.test/","active":true},{"tabId":"t2","title":"","url":"","active":false}]}"""
        val tabs = assertIs<BrowserLiveMessage.Tabs>(BrowserLiveDecoder.message(tabsJson)).tabs
        assertEquals(listOf("t1", "t2"), tabs.map { it.tabId })
        assertTrue(tabs[0].active)

        assertEquals(
            "v-1",
            assertIs<BrowserLiveMessage.Viewer>(
                BrowserLiveDecoder.message("""{"type":"viewer","viewerId":"v-1"}"""),
            ).id,
        )
    }

    @Test
    fun decodesAnErrorWithAFallbackMessage() {
        val message = assertIs<BrowserLiveMessage.Error>(
            BrowserLiveDecoder.message("""{"type":"error"}"""),
        ).message

        assertFalse(message.isEmpty())
    }

    /** A type we have never seen is a protocol change, not a reason to tear
     * down a stream the person is watching. */
    @Test
    fun anUnknownTypeIsDroppedRatherThanFatal() {
        assertNull(BrowserLiveDecoder.message("""{"type":"something-new","x":1}"""))
    }

    @Test
    fun malformedInputIsRejectedWithoutThrowing() {
        assertNull(BrowserLiveDecoder.message("not json"))
        assertNull(BrowserLiveDecoder.message("{}"))
        // A frame without its metadata cannot be mapped to coordinates.
        assertNull(BrowserLiveDecoder.message("""{"type":"frame","seq":1,"data":"x"}"""))
    }

    @Test
    fun frameBytesDecodeFromBase64() {
        val json = """{"type":"frame","seq":1,"data":"aGVsbG8=","metadata":{"deviceWidth":10,"deviceHeight":10}}"""

        val frame = assertIs<BrowserLiveMessage.Frame>(BrowserLiveDecoder.message(json)).frame

        assertEquals("hello", frame.bytes()?.decodeToString())
    }
}
