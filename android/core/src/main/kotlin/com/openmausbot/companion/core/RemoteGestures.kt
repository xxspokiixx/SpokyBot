package com.openmausbot.companion.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Contract values shared with CompanionCore's `GestureConstants`. A value that
 * differs between the two platforms is a bug the parity fixture must catch, so
 * they are stated once here and once there rather than derived from anything —
 * a derivation is a place the two can quietly disagree.
 */
object GestureConstants {
    /** Longest gap that still extends a click sequence. */
    const val MULTI_CLICK_WINDOW = 0.450

    /** Furthest a finger may land from the last tap and still count as a
     * double click rather than two clicks on two different targets. */
    const val MULTI_CLICK_SLOP = 0.02

    /** Hold before a long press fires. */
    const val LONG_PRESS = 0.500

    /** Movement that cancels a pending long press. */
    const val LONG_PRESS_SLOP = 0.015

    /** Movement before a touch is a drag rather than a tap. */
    const val DRAG_THRESHOLD = 0.01

    /** A sequence wraps rather than growing without bound. */
    const val MAX_CLICKS = 3

    const val MIN_ZOOM = 1.0
    const val MAX_ZOOM = 6.0

    /** Per-frame velocity decay at 60fps, and the speed below which a flick
     * has visibly stopped and should send nothing further. */
    const val MOMENTUM_DECAY = 0.94
    const val MOMENTUM_CUTOFF = 0.0004
}

@Serializable
enum class TouchPhase {
    @SerialName("began")
    BEGAN,

    @SerialName("moved")
    MOVED,

    @SerialName("ended")
    ENDED,

    @SerialName("cancelled")
    CANCELLED,
}

/**
 * One finger at one instant, in the view's own pixel space.
 *
 * The core does every conversion itself, so an adapter never needs to know the
 * frame's size, the letterbox insets or the zoom. That is what keeps the
 * platform layers free of arithmetic worth testing.
 *
 * @property t seconds from any fixed origin; the core has no clock of its own,
 *   so this is the only time it ever sees.
 */
@Serializable
data class TouchSample(
    val id: Int,
    val phase: TouchPhase,
    val x: Double,
    val y: Double,
    val t: Double,
)

@Serializable
enum class RemoteButton {
    @SerialName("left")
    LEFT,

    @SerialName("right")
    RIGHT,

    @SerialName("middle")
    MIDDLE,
}

/**
 * What the remote should be told.
 *
 * Zoom and pan are deliberately absent. They are local view state, and sending
 * them would reflow the remote page under the person instead of magnifying
 * their own copy of it.
 *
 * The wire shape mirrors CompanionCore's hand-written coding so one parity
 * fixture serves both platforms: `{"move":{"x":…,"y":…}}` and its siblings.
 */
@Serializable
sealed interface GestureIntent {
    @Serializable
    @SerialName("move")
    data class Move(val x: Double, val y: Double) : GestureIntent

    @Serializable
    @SerialName("press")
    data class Press(val button: RemoteButton, val clicks: Int) : GestureIntent

    @Serializable
    @SerialName("release")
    data class Release(val button: RemoteButton) : GestureIntent

    @Serializable
    @SerialName("scroll")
    data class Scroll(val dx: Double, val dy: Double) : GestureIntent

    @Serializable
    @SerialName("text")
    data class Text(val value: String) : GestureIntent

    @Serializable
    @SerialName("key")
    data class Key(val name: String, val modifiers: Int) : GestureIntent
}

@Serializable
enum class GestureMode {
    @SerialName("direct")
    DIRECT,

    @SerialName("trackpad")
    TRACKPAD,
}

/**
 * Local magnification. [offsetX] and [offsetY] are the top-left of the visible
 * window in normalised frame units, so identity shows the whole frame.
 */
@Serializable
data class ViewTransform(val scale: Double, val offsetX: Double, val offsetY: Double) {
    companion object {
        val IDENTITY = ViewTransform(1.0, 0.0, 0.0)
    }
}

/** A point on the remote surface, normalised to 0..1. */
data class RemotePoint(val x: Double, val y: Double)

/**
 * The only thing in the system that thinks in pixels.
 *
 * It folds three transforms into one: aspect-fit letterboxing, local zoom and
 * local pan. Keeping them together means there is a single place where a
 * coordinate can be got wrong, and a single place to test.
 */
data class ViewportMapping(
    val viewWidth: Double,
    val viewHeight: Double,
    val frameWidth: Double,
    val frameHeight: Double,
    val transform: ViewTransform,
) {
    /**
     * Normalised frame coordinates for a view point, or null when the point is
     * outside the drawn image and no drag has captured the pointer.
     *
     * [captured] is the difference between a stray tap on the letterbox, which
     * means nothing and is refused, and a selection drag that wandered off the
     * image, which must keep tracking at the edge.
     */
    fun remotePoint(viewX: Double, viewY: Double, captured: Boolean): RemotePoint? {
        val sizes = listOf(viewWidth, viewHeight, frameWidth, frameHeight)
        if (sizes.any { !it.isFinite() || it <= 0 }) return null
        if (!viewX.isFinite() || !viewY.isFinite()) return null
        if (!transform.scale.isFinite() || transform.scale <= 0) return null

        val fit = min(viewWidth / frameWidth, viewHeight / frameHeight)
        val drawnWidth = frameWidth * fit
        val drawnHeight = frameHeight * fit
        val localX = (viewX - (viewWidth - drawnWidth) / 2) / drawnWidth
        val localY = (viewY - (viewHeight - drawnHeight) / 2) / drawnHeight
        if (!captured && (localX < 0 || localY < 0 || localX > 1 || localY > 1)) return null

        return RemotePoint(
            x = min(max(transform.offsetX + localX / transform.scale, 0.0), 1.0),
            y = min(max(transform.offsetY + localY / transform.scale, 0.0), 1.0),
        )
    }
}
