package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals

class SharedMessageTest {
    @Test
    fun composerDeduplicatesVisibleContentAndEscapesOnlyTagAttributes() {
        assertEquals(
            """
            Summarize this

            A useful excerpt.

            https://example.com/story

            <attached-image path="/tmp/a&amp;&quot;b.png" />

            <attached-file path="/tmp/notes&lt;final&gt;.pdf" name="Project notes.pdf" />
            """.trimIndent(),
            SharedMessageComposer.compose(
                instruction = "  Summarize this  ",
                text = listOf("  A useful excerpt.\n", "A useful excerpt.", " "),
                urls = listOf("https://example.com/story", "https://example.com/story"),
                attachments = listOf(
                    SharedAttachmentReference("/tmp/a&\"b.png", SharedAttachmentKind.IMAGE),
                    SharedAttachmentReference(
                        "/tmp/notes<final>.pdf",
                        SharedAttachmentKind.FILE,
                        "Project notes.pdf",
                    ),
                ),
            ),
        )
    }
}
