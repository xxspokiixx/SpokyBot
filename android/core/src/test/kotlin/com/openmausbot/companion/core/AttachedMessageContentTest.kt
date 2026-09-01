package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AttachedMessageContentTest {
    @Test
    fun splitsSharedImagesAndNamedFilesFromVisibleText() {
        val parsed = AttachedMessageContent.parse(
            """Please review these.

<attached-image path="/tmp/photo.png" />

<attached-file path="/tmp/4ad3.pdf" name="Project &amp; notes.pdf" />""",
        )

        assertEquals("Please review these.", parsed.text)
        assertEquals(
            listOf(
                DisplayedMessageAttachment(DisplayedMessageAttachment.Kind.IMAGE, "photo.png"),
                DisplayedMessageAttachment(DisplayedMessageAttachment.Kind.FILE, "Project & notes.pdf"),
            ),
            parsed.attachments,
        )
    }

    @Test
    fun fallsBackToBasenameForOlderFileTags() {
        val parsed = AttachedMessageContent.parse(
            """<attached-file path="C:\Users\Maus\brief.docx" />""",
        )
        assertEquals("", parsed.text)
        assertEquals("brief.docx", parsed.attachments.single().name)
    }

    @Test
    fun leavesInlineExamplesAndUnrelatedTagsVisible() {
        val source = "Example: <attached-file path=\"/tmp/demo.pdf\" />\n<pasted-text>hello</pasted-text>"
        val parsed = AttachedMessageContent.parse(source)
        assertEquals(source, parsed.text)
        assertTrue(parsed.attachments.isEmpty())
    }

    @Test
    fun boundsAndFlattensUntrustedDisplayNames() {
        val longName = "\u202E" + "a".repeat(200) + "&#10;.pdf"
        val parsed = AttachedMessageContent.parse(
            """<attached-file path="/tmp/file.pdf" name="$longName" />""",
        )
        val name = parsed.attachments.single().name
        assertEquals(180, name.length)
        assertFalse('\n' in name)
        assertFalse('\u202E' in name)
    }
}
