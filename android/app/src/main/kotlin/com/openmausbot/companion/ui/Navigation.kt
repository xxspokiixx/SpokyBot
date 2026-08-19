package com.openmausbot.companion.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

/**
 * Where the app can be. Four places, one stack, no dependency.
 *
 * `androidx.navigation-compose` would add a library, a graph DSL and an argument
 * encoding to express roster ⇄ chat ⇄ settings — CONTRIBUTING asks not to add a
 * dependency where a short module will do, and this is the short module.
 *
 * A chat is addressed by `threadId`, not by a captured `Chat`: the record has to
 * be re-read from `Session.state` on every frame anyway so busy/unread stay
 * current (iOS `ChatView.current` does the same), and a thread id is also what a
 * notification tap arrives carrying.
 */
sealed interface Destination {
    data object Roster : Destination
    data class Thread(val threadId: String) : Destination
    data object Settings : Destination

    /** A bot's computer, watch-only. Addressed by bot id for the same reason. */
    data class Computer(val botId: String) : Destination
}

@Stable
class CompanionNavigator(initial: List<Destination> = listOf(Destination.Roster)) {
    var stack: List<Destination> by mutableStateOf(initial.ifEmpty { listOf(Destination.Roster) })
        private set

    val current: Destination get() = stack.last()
    val canGoBack: Boolean get() = stack.size > 1

    fun push(destination: Destination) {
        if (stack.last() == destination) return
        stack = stack + destination
    }

    fun pop() {
        if (canGoBack) stack = stack.dropLast(1)
    }

    fun resetToRoster() {
        stack = listOf(Destination.Roster)
    }

    /** A notification tap lands on the thread, with the roster behind it. */
    fun openThread(threadId: String) {
        stack = listOf(Destination.Roster, Destination.Thread(threadId))
    }

    companion object {
        private const val ROSTER = "roster"
        private const val SETTINGS = "settings"
        private const val THREAD = "thread:"
        private const val COMPUTER = "computer:"

        fun encode(stack: List<Destination>): List<String> = stack.map {
            when (it) {
                Destination.Roster -> ROSTER
                Destination.Settings -> SETTINGS
                is Destination.Thread -> THREAD + it.threadId
                is Destination.Computer -> COMPUTER + it.botId
            }
        }

        fun decode(raw: List<String>): List<Destination> = raw.mapNotNull {
            when {
                it == ROSTER -> Destination.Roster
                it == SETTINGS -> Destination.Settings
                it.startsWith(THREAD) -> Destination.Thread(it.removePrefix(THREAD))
                it.startsWith(COMPUTER) -> Destination.Computer(it.removePrefix(COMPUTER))
                else -> null
            }
        }

        val Saver: Saver<CompanionNavigator, List<String>> = Saver(
            save = { encode(it.stack) },
            restore = { CompanionNavigator(decode(it)) },
        )
    }
}

@Composable
fun rememberCompanionNavigator(): CompanionNavigator =
    rememberSaveable(saver = CompanionNavigator.Saver) { CompanionNavigator() }
