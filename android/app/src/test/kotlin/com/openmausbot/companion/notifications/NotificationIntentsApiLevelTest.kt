package com.openmausbot.companion.notifications

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * A source pin, and it says so.
 *
 * `URLEncoder.encode(String, Charset)` and `URLDecoder.decode(String, Charset)`
 * were added to Android in **API 33** — the SDK's own `api-versions.xml` marks
 * them `since="33"`. This app is `minSdk 26`, so on Android 8.0 through 12L those
 * overloads are simply not on the device and a call to one dies with
 * `NoSuchMethodError`. For [NotificationIntents] that lands inside
 * `LocalNotificationPoster.deliver`, where nothing catches it: the first
 * notification of the session takes the process with it.
 *
 * **What this test proves, and what it does not.** It cannot reproduce the
 * crash. These tests run on a desktop JDK, which has had the `Charset` overloads
 * since Java 10, so every JVM suite — including Robolectric, which does not
 * shadow `java.*` — resolves the method happily no matter what SDK is
 * configured. Only a device or emulator below API 33 can observe the failure.
 * What is pinned here is therefore the *source*: no production Kotlin file may
 * call those overloads while `minSdk` still makes them unsafe.
 *
 * **And because it cannot be reproduced, this pin is not a second layer — it is
 * the layer.** That is what decides every judgement call below, and all of them
 * are decided the same way: a false positive here costs whoever hits it one
 * inline edit and a glance at this comment; a false negative ships a crash to
 * every Android 8-to-12 phone that ever gets a notification. So the rule is not
 * "reject the spelling that was wrong once", it is **"accept only the spellings
 * that are provably the `String` overload, and refuse everything else."**
 *
 * Three consequences worth knowing before you edit:
 *
 * - **The check reads arguments, not text.** An earlier version matched the
 *   literal shape `encode(v, StandardCharsets.UTF_8)` and was defeated by
 *   `val charset = StandardCharsets.UTF_8; encode(v, charset)` — the same call,
 *   one refactor away, with the pin still green. It now splits the real argument
 *   list and classifies the second argument, following local `val` aliases in
 *   the same file.
 * - **An argument it cannot classify is refused.** A name declared in another
 *   file, a function call, a parameter — all fail, because none of them can be
 *   shown from here to be a `String`. Inline `.name()` at the call site and the
 *   refusal goes away. That is the false-positive cost, and it is the cheap side
 *   of the trade above.
 * - **There is no core-library-desugaring escape hatch, deliberately.** The
 *   obvious one — "the pin steps aside if desugaring is on" — would be an escape
 *   granting a safety nobody here has checked: `desugar_jdk_libs` backports a
 *   published list of JDK APIs, this repository does not use desugaring anywhere
 *   and does not have the artifact on disk, so whether `java.net.URLEncoder` is
 *   on that list is not a fact this test can establish. `minSdk` is, from
 *   `api-versions.xml`, so `minSdk` is the only premise this pin rests on.
 */
class NotificationIntentsApiLevelTest {

    /** API level the `Charset` overloads arrived on Android. */
    private val charsetOverloadApi = 33

    @Test
    fun `no production source calls the API 33 charset overloads while minSdk is below 33`() {
        val buildFile = scannable(locate("app/build.gradle.kts").readText())
        val minSdk = Regex("""\bminSdk\s*=\s*(\d+)""").find(buildFile)?.groupValues?.get(1)?.toInt()
        assertTrue(minSdk != null, "could not read minSdk from app/build.gradle.kts")

        if (minSdk!! >= charsetOverloadApi) {
            // The premise is gone; so is the rule.
            return
        }

        val offenders = productionSources()
            .flatMap { file -> unsafeArguments(file.readText()).map { "${file.name}: $it" } }
            .sorted()

        assertEquals(
            emptyList(),
            offenders,
            "minSdk $minSdk cannot call URLEncoder.encode(String, Charset) / " +
                "URLDecoder.decode(String, Charset) — API $charsetOverloadApi. The second " +
                "argument must be a String this file can prove: a literal, or something " +
                "ending in .name(). Offenders: $offenders",
        )
    }

    @Test
    fun `the scanner refuses every charset spelling and clears only provable Strings`() {
        // Without this the rule above could be vacuously green: a scanner that
        // finds nothing passes every file in the repository.

        // The literal form.
        assertRefused("""URLEncoder.encode(v, StandardCharsets.UTF_8)""")
        assertRefused("""java.net.URLEncoder.encode(v, java.nio.charset.StandardCharsets.UTF_8)""")
        assertRefused("""URLDecoder.decode(v, Charsets.UTF_8)""")

        // The refactor the literal form missed: the Charset behind a name.
        assertRefused(
            """
            val charset = StandardCharsets.UTF_8
            URLEncoder.encode(v, charset)
            """,
        )
        assertRefused(
            """
            private val CHARSET = Charsets.UTF_8
            fun f(v: String) = URLDecoder.decode(v, CHARSET)
            """,
        )
        assertRefused("""URLEncoder.encode(v, Charset.forName("UTF-8"))""")
        assertRefused("""URLEncoder.encode(v, charsetOf(v))""")
        // Declared somewhere this file cannot see: refused on purpose.
        assertRefused("""URLEncoder.encode(v, encodingFromAnotherFile)""")

        // The two spellings that are provably the String overload.
        assertCleared("""URLEncoder.encode(v, StandardCharsets.UTF_8.name())""")
        assertCleared("""URLEncoder.encode(v, "UTF-8")""")
        assertCleared(
            """
            val encoding = StandardCharsets.UTF_8.name()
            URLEncoder.encode(v, encoding)
            """,
        )
        assertCleared(
            """
            val encoding: String = charsetName()
            URLEncoder.encode(v, encoding)
            """,
        )
        // Commented-out code is not code.
        assertCleared("""// URLEncoder.encode(v, StandardCharsets.UTF_8)""")
        assertCleared("""/* URLEncoder.encode(v, StandardCharsets.UTF_8) */""")
        // A string that merely contains the call is not the call.
        assertCleared("""val doc = "URLEncoder.encode(v, StandardCharsets.UTF_8)" """)
        // The one-argument overload is API 1 and not this rule's business.
        assertCleared("""URLEncoder.encode(v)""")
    }

    @Test
    fun `the minSdk premise is read from the build file, not assumed`() {
        val buildFile = scannable(locate("app/build.gradle.kts").readText())
        val minSdk = Regex("""\bminSdk\s*=\s*(\d+)""").find(buildFile)?.groupValues?.get(1)?.toInt()

        assertEquals(
            26,
            minSdk,
            "the pin above is conditional on this number; if it moved, read the rule again",
        )
    }

    @Test
    fun `the notification data URI still encodes what the old overload encoded`() {
        // The swap must be behaviour-preserving, not just compile-preserving:
        // reserved characters stay percent-encoded and a space stays %20.
        assertEquals(
            "openmaus://notification/bot%20one/a%2Fb%3Fc",
            NotificationIntents.contentIdentity("bot one", "a/b?c"),
        )
    }

    // MARK: - The scanner

    /**
     * Every second argument of an `encode`/`decode` call this source cannot show
     * to be a `String`. Empty means the file is clean.
     */
    private fun unsafeArguments(source: String): List<String> {
        val clean = scannable(source)
        return charsetCalls(clean)
            .filter { it.arguments.size >= 2 }
            .map { it.arguments[1].trim() }
            .filterNot { isProvableString(it, clean) }
    }

    private data class Call(val name: String, val arguments: List<String>)

    private fun charsetCalls(source: String): List<Call> {
        val literals = literalRanges(source)
        return Regex("""\b(URLEncoder\.encode|URLDecoder\.decode)\s*\(""")
            .findAll(source)
            // A call spelled inside a doc string is prose, not a call.
            .filterNot { match -> literals.any { match.range.first in it } }
            .mapNotNull { match ->
                argumentsFrom(source, source.indexOf('(', match.range.last - 1))
                    ?.let { Call(match.groupValues[1], it) }
            }
            .toList()
    }

    /** Where the string and char literals are, so the scanner can stay out of them. */
    private fun literalRanges(source: String): List<IntRange> {
        val ranges = mutableListOf<IntRange>()
        var index = 0
        while (index < source.length) {
            val end = literalAt(source, index)
            if (end == null) {
                index += 1
            } else {
                ranges += index until end
                index = end
            }
        }
        return ranges
    }

    /**
     * The argument list starting at [openParen], split on top-level commas.
     * String literals and nested brackets are stepped over rather than counted,
     * so `encode(v, name(","))` is still two arguments.
     */
    private fun argumentsFrom(source: String, openParen: Int): List<String>? {
        if (openParen < 0 || source.getOrNull(openParen) != '(') return null
        val arguments = mutableListOf<String>()
        val current = StringBuilder()
        var depth = 0
        var index = openParen
        while (index < source.length) {
            val literal = literalAt(source, index)
            if (literal != null && depth > 0) {
                current.append(source, index, literal)
                index = literal
                continue
            }
            when (val c = source[index]) {
                '(', '[', '{' -> {
                    depth += 1
                    if (depth > 1) current.append(c)
                }
                ')', ']', '}' -> {
                    depth -= 1
                    if (depth == 0) {
                        if (current.isNotBlank() || arguments.isNotEmpty()) arguments += current.toString()
                        return arguments
                    }
                    current.append(c)
                }
                ',' -> if (depth == 1) {
                    arguments += current.toString()
                    current.clear()
                } else {
                    current.append(c)
                }
                else -> if (depth > 0) current.append(c)
            }
            index += 1
        }
        return null
    }

    /**
     * True only for the two spellings that are provably the API 1 `String`
     * overload: a string literal, or an expression ending in `.name()`. A bare
     * name is followed to its `val` in the same file, at most [hops] times;
     * anything else is refused.
     */
    private fun isProvableString(expression: String, source: String, hops: Int = 4): Boolean {
        val expr = expression.trim()
        if (expr.isEmpty()) return false
        if (expr.startsWith("\"")) return true
        if (expr.endsWith(".name()")) return true
        if (hops <= 0) return false
        if (!expr.matches(Regex("""[A-Za-z_][A-Za-z0-9_]*"""))) return false

        val declaration = Regex(
            """\b(?:const\s+)?(?:val|var)\s+${Regex.escape(expr)}\s*(?::\s*([A-Za-z_.]+\??))?\s*=\s*([^\n]+)""",
        ).find(source) ?: return false
        val declaredType = declaration.groupValues[1]
        if (declaredType.isNotEmpty()) return declaredType.trimEnd('?').substringAfterLast('.') == "String"
        return isProvableString(declaration.groupValues[2], source, hops - 1)
    }

    /** Index just past the literal starting at [index], or null if none starts there. */
    private fun literalAt(source: String, index: Int): Int? {
        if (source.startsWith("\"\"\"", index)) {
            val end = source.indexOf("\"\"\"", index + 3)
            return if (end < 0) source.length else end + 3
        }
        val quote = source.getOrNull(index)?.takeIf { it == '"' || it == '\'' } ?: return null
        var cursor = index + 1
        while (cursor < source.length && source[cursor] != quote) {
            if (source[cursor] == '\\') cursor += 1
            cursor += 1
        }
        return minOf(cursor + 1, source.length)
    }

    /**
     * Comments removed, string literals kept verbatim.
     *
     * Removing comments is load-bearing twice over: a call that is commented out
     * is not a call, and `minSdk` written in prose is not the build's `minSdk`.
     * Literals are *kept* rather than blanked so a refusal can quote the argument
     * the way it was actually written; [literalRanges] is what stops the scanner
     * reading a call out of the inside of one.
     */
    private fun scannable(source: String): String {
        val out = StringBuilder(source.length)
        var index = 0
        while (index < source.length) {
            val literal = literalAt(source, index)
            if (literal != null) {
                out.append(source, index, literal)
                index = literal
                continue
            }
            when {
                source.startsWith("//", index) -> {
                    val end = source.indexOf('\n', index)
                    index = if (end < 0) source.length else end
                }
                source.startsWith("/*", index) -> {
                    val end = source.indexOf("*/", index + 2)
                    out.append(' ')
                    index = if (end < 0) source.length else end + 2
                }
                else -> {
                    out.append(source[index])
                    index += 1
                }
            }
        }
        return out.toString()
    }

    private fun assertRefused(snippet: String) {
        assertTrue(
            unsafeArguments(snippet).isNotEmpty(),
            "the scanner cleared a call it cannot prove is the String overload: $snippet",
        )
    }

    private fun assertCleared(snippet: String) {
        assertEquals(
            emptyList(),
            unsafeArguments(snippet),
            "the scanner refused a call that is provably the String overload: $snippet",
        )
    }

    private fun productionSources(): List<File> =
        listOf("app/src/main/kotlin", "core/src/main/kotlin")
            .map(::locate)
            .flatMap { it.walkTopDown().filter { file -> file.isFile && file.extension == "kt" } }

    private fun locate(relative: String): File {
        var directory: File? = File(".").absoluteFile
        while (directory != null) {
            val candidate = File(directory, relative)
            if (candidate.exists()) return candidate
            directory = directory.parentFile
        }
        error("could not find $relative from ${File(".").absolutePath}")
    }
}
