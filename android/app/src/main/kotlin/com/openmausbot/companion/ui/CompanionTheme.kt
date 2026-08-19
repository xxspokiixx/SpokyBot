package com.openmausbot.companion.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * The app's colours. Deliberately small: the roster and chat draw almost
 * everything from `secondary` opacities the way the SwiftUI screens draw from
 * `Color.secondary`, and the one branded colour is the mascot green the desktop
 * uses for the profile avatar.
 */
private val Green = Color(MausPalette.argb("green"))

private val LightColors = lightColorScheme(
    primary = Green,
    onPrimary = Color.White,
    secondary = Green,
)

private val DarkColors = darkColorScheme(
    primary = Green,
    onPrimary = Color.White,
    secondary = Green,
)

@Composable
fun CompanionTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}

/** SwiftUI's `Color.secondary` — the muted foreground everything quiet uses. */
val secondaryTint: Color
    @Composable get() = MaterialTheme.colorScheme.onSurfaceVariant
