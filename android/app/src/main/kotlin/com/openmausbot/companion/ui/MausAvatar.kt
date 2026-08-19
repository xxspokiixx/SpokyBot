package com.openmausbot.companion.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Box

/**
 * A bot, at whatever size the row needs — the port of `MausAvatar` in
 * `ios/App/MausAvatar.swift`. Silhouette and two eyes; no expression engine.
 */
@Composable
fun MausAvatar(color: String, size: Dp = 52.dp, modifier: Modifier = Modifier) {
    val stops = remember(color) {
        MausPalette.gradient(color).map { (position, argb) -> position to Color(argb) }.toTypedArray()
    }
    Canvas(
        modifier = modifier
            .size(size)
            // The mascot repeats the name beside it; announcing it twice is noise.
            .semantics { },
    ) {
        val body = silhouettePath(this.size)
        drawPath(
            path = body,
            brush = Brush.linearGradient(
                colorStops = stops,
                start = Offset(this.size.width, 0f),
                end = Offset(0f, this.size.height),
            ),
        )
        drawEyes(this.size)
    }
}

/** The silhouette normalised to fill [box], preserving aspect. */
private fun silhouettePath(box: Size): Path {
    val bounds = MausSilhouette.bounds
    val path = Path()
    if (bounds.width <= 0f || bounds.height <= 0f) return path
    val scale = minOf(box.width / bounds.width, box.height / bounds.height)
    fun mapX(x: Float) = (x - bounds.midX) * scale + box.width / 2f
    fun mapY(y: Float) = (y - bounds.midY) * scale + box.height / 2f

    for (command in MausSilhouette.commands) {
        when (command) {
            is MausSilhouette.Command.MoveTo -> path.moveTo(mapX(command.x), mapY(command.y))
            is MausSilhouette.Command.CurveTo -> path.cubicTo(
                mapX(command.c1x), mapY(command.c1y),
                mapX(command.c2x), mapY(command.c2y),
                mapX(command.x), mapY(command.y),
            )
            MausSilhouette.Command.Close -> path.close()
        }
    }
    return path
}

/**
 * Eyes at the desktop's face anchor expressed as a fraction of the box:
 * (93, 101) of 228.541. One neutral expression.
 */
private fun DrawScope.drawEyes(box: Size) {
    val eyeWidth = box.width * 0.085f
    val eyeHeight = eyeWidth * 1.7f
    val gap = eyeWidth * 1.9f
    val centerX = box.width * 0.407f
    val centerY = box.height * 0.442f
    for (dx in listOf(-gap / 2f, gap / 2f)) {
        drawRoundRect(
            color = Color.White,
            topLeft = Offset(centerX + dx - eyeWidth / 2f, centerY - eyeHeight / 2f),
            size = Size(eyeWidth, eyeHeight),
            cornerRadius = CornerRadius(eyeWidth / 2f),
        )
    }
}

/**
 * The person, not a bot — the roster header and the settings row. A letter
 * rather than a mascot, deliberately: the mascots mean "this is a bot", and
 * giving the human one too would blur the only distinction the roster makes.
 */
@Composable
fun ProfileAvatar(name: String, size: Dp = 34.dp, modifier: Modifier = Modifier) {
    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            drawCircle(color = Color(MausPalette.argb("green")))
        }
        Text(
            text = name.trim().take(1).uppercase(),
            color = Color.White,
            fontSize = (size.value * 0.45f).sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
