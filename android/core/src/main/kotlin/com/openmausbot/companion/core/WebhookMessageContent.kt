package com.openmausbot.companion.core

/** Display projection only. Stored prompts keep their model-facing trust boundaries. */
data class WebhookMessageContent(val task: String, val payload: String?) {
    companion object {
        private val taskMarkers = listOf(
            "AUTHENTICATED WEBHOOK TASK", "USER-CONFIGURED WEBHOOK INSTRUCTIONS", "DEFAULT WEBHOOK INSTRUCTIONS",
        )

        /** Matches the desktop webhook-message parser. Incomplete envelopes remain ordinary text. */
        fun parse(text: String): WebhookMessageContent? {
            fun block(marker: String): String? {
                val opening = "[$marker]\n"
                val start = text.indexOf(opening).takeIf { it >= 0 } ?: return null
                val contentStart = start + opening.length
                val end = text.indexOf("\n[/$marker]", contentStart).takeIf { it >= 0 } ?: return null
                return text.substring(contentStart, end)
            }
            val task = taskMarkers.firstNotNullOfOrNull { block(it)?.trim()?.takeIf(String::isNotEmpty) } ?: return null
            val event = block("UNTRUSTED WEBHOOK EVENT DATA")?.takeIf(String::isNotEmpty) ?: return null
            val splitAt = event.indexOf("\n\n")
            val payload = if (splitAt >= 0) event.substring(splitAt + 2).trim().takeIf(String::isNotEmpty) else null
            return WebhookMessageContent(task, payload)
        }
    }
}

val Message.webhookContent: WebhookMessageContent?
    get() = if (role == Message.Role.USER && kind == Message.Kind.TEXT) text?.let(WebhookMessageContent::parse) else null
