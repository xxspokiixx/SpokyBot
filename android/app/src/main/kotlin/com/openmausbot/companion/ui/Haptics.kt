package com.openmausbot.companion.ui

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

/**
 * The two things this app has to say through the motor — the Android half of
 * what `Haptics` and `SoundEffects` do in `ios/App/PlatformBridge.swift`.
 *
 * Android's own constants, not Apple's generators, and no sound at all. iOS
 * pairs its send impact with `AudioServicesPlaySystemSound(1004)`; those ids
 * name Apple's sounds, there is no equivalent id here, and an app that invents a
 * send chime on a platform whose keyboard already owns that job is an app that
 * gets muted. The feedback constants are the right register: they are one call,
 * they respect the system's touch-feedback setting for free, and a device with
 * no vibrator simply does nothing.
 */
enum class HapticCue {
    /** A message left the phone. */
    SEND,

    /** Something was picked from a list of things. */
    SELECT,
}

object CompanionHaptics {
    /**
     * [HapticFeedbackConstants] for a cue, given the platform running it.
     *
     * The constant has to name the action, not merely produce a buzz: the
     * platform routes each one through its own effect, and a device with a
     * richer actuator plays them apart. So each cue is the constant Android
     * defines for what actually happened, with a fallback chosen for the same
     * gesture rather than for convenience.
     *
     * **Send.** `CONFIRM` is what the platform means by "that worked", and it
     * arrived in API 30. Below that the view would be handed an effect it does
     * not know and would do nothing at all, so 26..29 fall back to
     * `KEYBOARD_TAP` — the honest description of what happened there: a key was
     * pressed and the message went.
     *
     * **Select.** Every site that plays it is a move to one of a set of discrete
     * things — a command card, a disclosure opening or closing, a discovered
     * computer, a copy landing on the clipboard. From API 34 the platform has a
     * constant that says precisely that: `SEGMENT_TICK`, documented as "the user
     * is switching between a series of potential choices, for example items in a
     * list or discrete points on a slider".
     *
     * Below 34 the fallback is `CLOCK_TICK` (API 21). Its javadoc names the
     * clock — "an hour or minute tick" — but that *is* the pre-34 vocabulary for
     * landing on the next discrete value, which is why the framework's own
     * pickers play it, and it is the softest tick of that family. Explicitly not
     * `CONTEXT_CLICK`: Android defines that as "the user has performed a context
     * click on an object", the secondary gesture — a stylus button, a
     * right-click — and not one of these sites is one. Explicitly not
     * `KEYBOARD_TAP` either: that is the send's fallback, and a selection that
     * felt identical to a send would collapse the two cues into one.
     */
    fun constant(cue: HapticCue, sdkInt: Int = Build.VERSION.SDK_INT): Int = when (cue) {
        HapticCue.SEND ->
            if (sdkInt >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.KEYBOARD_TAP
            }

        HapticCue.SELECT ->
            if (sdkInt >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                HapticFeedbackConstants.SEGMENT_TICK
            } else {
                HapticFeedbackConstants.CLOCK_TICK
            }
    }

    /**
     * The cue a slash command earns, or none.
     *
     * iOS fires both for a command that sends: `onSelectCommand` runs `submit`,
     * which plays the sent sound and a medium impact before it even creates its
     * `Task`, and then the HUD adds its own `Haptics.selection()` — both
     * synchronously, on the one gesture's stack. On a phone that has only the
     * motor, two effects back to back are one muddled buzz — so a command that
     * sends is felt as a send, and only a command that navigates is felt as a
     * selection. One gesture, one cue.
     */
    fun forCommand(effect: SlashEffect): HapticCue? = when (effect) {
        is SlashEffect.Send -> null
        SlashEffect.OpenComputer, SlashEffect.OpenTasks -> HapticCue.SELECT
    }
}

/** One cue, played on the window this composition is in. */
fun interface Haptics {
    fun play(cue: HapticCue)
}

/**
 * The view is the thing that can vibrate, and it does not change under a screen;
 * this is remembered against it so a tap handler is not rebuilding the lookup.
 */
@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) {
        Haptics { cue -> view.performHapticFeedback(CompanionHaptics.constant(cue)) }
    }
}
