package com.openmausbot.companion.core

/** A safe, quiet label for an attachment encoded in a stored user prompt. */
data class DisplayedMessageAttachment(
    val kind: Kind,
    val name: String,
) {
    enum class Kind { IMAGE, FILE }
}

data class AttachedMessageContent(
    val text: String,
    val attachments: List<DisplayedMessageAttachment>,
) {
    companion object {
        /** Split only exact standalone tags; inline examples remain ordinary prose. */
        fun parse(source: String): AttachedMessageContent {
            val attachments = TAG.findAll(source).map { match ->
                val kind = if (match.groupValues[1] == "image") {
                    DisplayedMessageAttachment.Kind.IMAGE
                } else {
                    DisplayedMessageAttachment.Kind.FILE
                }
                val path = decodeAttribute(match.groupValues[2])
                val provided = match.groups[3]?.value?.let(::decodeAttribute)
                DisplayedMessageAttachment(kind, displayName(provided, path, kind))
            }.toList()
            return AttachedMessageContent(
                text = TAG.replace(source, "").trim(),
                attachments = attachments,
            )
        }

        private val TAG = Regex(
            """(?m)^[\t ]*<attached-(image|file)[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*/>[\t ]*(?:\r?\n)?""",
        )

        private fun decodeAttribute(value: String): String = value
            .replace("&#9;", "\t")
            .replace("&#10;", "\n")
            .replace("&#13;", "\r")
            .replace("&quot;", "\"")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&")

        private fun displayName(
            providedName: String?,
            path: String,
            kind: DisplayedMessageAttachment.Kind,
        ): String {
            val fallback = path.split('/', '\\').lastOrNull(String::isNotEmpty)
            val candidate = providedName?.trim()?.takeIf(String::isNotEmpty)
            val raw = candidate ?: fallback ?: when (kind) {
                DisplayedMessageAttachment.Kind.IMAGE -> "Image"
                DisplayedMessageAttachment.Kind.FILE -> "File"
            }
            return raw.map { character ->
                if (
                    character.isISOControl() ||
                    character in '\u202A'..'\u202E' ||
                    character in '\u2066'..'\u2069'
                ) {
                    ' '
                } else {
                    character
                }
            }.joinToString("").take(180)
        }
    }
}
