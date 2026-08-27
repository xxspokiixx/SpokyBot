package com.openmausbot.companion.notifications

import android.content.Intent
import android.net.Uri
import com.openmausbot.companion.MainActivity
import com.openmausbot.companion.core.NotificationFrame
import com.openmausbot.companion.core.NotificationTarget
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * The two ids a notification tap carries — the same pair iOS reads from
 * `userInfo` in `Notifications.swift:65-69`. Both are required; a partial
 * extra is not a destination.
 */
fun Intent.notificationTarget(): NotificationTarget? =
    NotificationTarget.from(
        getStringExtra(LocalNotificationPoster.EXTRA_BOT_ID),
        getStringExtra(LocalNotificationPoster.EXTRA_THREAD_ID),
    )

/**
 * Filterable identity for notification content Intents.
 *
 * PendingIntent equality uses request code plus Intent.filterEquals fields
 * (action, data, type, package, component, categories) — **extras do not
 * participate**. Putting `botId` and `threadId` only in extras lets two
 * notifications for the same room thread, or two thread ids whose
 * `String.hashCode()` collide, share one PendingIntent and overwrite each
 * other's target under `FLAG_UPDATE_CURRENT`.
 *
 * The data URI below is the unambiguous discriminator; it is never hashed.
 */
object NotificationIntents {
    const val ACTION_OPEN = "com.openmausbot.companion.OPEN_NOTIFICATION"

    /**
     * Stable, unhashed identity string for [android.content.Intent.setData].
     * Distinct for every `(botId, threadId)` pair — including UUID strings
     * that collide under 32-bit [String.hashCode].
     */
    fun contentIdentity(botId: String, threadId: String): String =
        "openmaus://notification/${encode(botId)}/${encode(threadId)}"

    fun contentUri(botId: String, threadId: String): Uri =
        Uri.parse(contentIdentity(botId, threadId))

    fun contentIntent(
        packageContext: android.content.Context,
        notification: NotificationFrame,
    ): Intent = Intent(packageContext, MainActivity::class.java).apply {
        action = ACTION_OPEN
        data = contentUri(notification.botId, notification.threadId)
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(LocalNotificationPoster.EXTRA_THREAD_ID, notification.threadId)
        putExtra(LocalNotificationPoster.EXTRA_BOT_ID, notification.botId)
        putExtra(LocalNotificationPoster.EXTRA_KIND, notification.kind)
    }

    /**
     * `URLEncoder.encode(String, Charset)` is API 33. This app is `minSdk 26`
     * with no core-library desugaring, so on Android 8.0 through 12L that
     * overload is not on the device and the first notification would die with
     * `NoSuchMethodError` — inside `LocalNotificationPoster.deliver`, where
     * nothing catches it. The name overload has been there since API 1 and
     * encodes identically; `UnsupportedEncodingException` cannot happen for a
     * charset the JVM is required to have.
     *
     * A JVM unit test cannot see this: the desktop JDK has had the Charset
     * overload since Java 10. [NotificationIntentsApiLevelTest] pins it at
     * source level instead.
     */
    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
}
