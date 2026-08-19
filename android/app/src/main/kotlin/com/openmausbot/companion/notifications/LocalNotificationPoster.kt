package com.openmausbot.companion.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.openmausbot.companion.MainActivity
import com.openmausbot.companion.R
import com.openmausbot.companion.core.NotificationFrame
import com.openmausbot.companion.core.NotificationSink

/**
 * Local-only notifications from live/replayed notify frames. No FCM.
 * PendingIntent carries threadId so a later pass can navigate on tap
 * (the one allowed quality delta vs iOS).
 */
class LocalNotificationPoster(
    context: Context,
) : NotificationSink {
    private val appContext = context.applicationContext
    private val manager = NotificationManagerCompat.from(appContext)

    init {
        ensureChannels()
    }

    override fun deliver(notification: NotificationFrame, sequence: Int?) {
        if (!canPost()) return
        val channelId = NotificationMapping.channelId(notification)
        val intent = Intent(appContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_THREAD_ID, notification.threadId)
            putExtra(EXTRA_BOT_ID, notification.botId)
            putExtra(EXTRA_KIND, notification.kind)
        }
        val requestCode = notification.threadId.hashCode()
        val pending = PendingIntent.getActivity(
            appContext,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(appContext, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(notification.title)
            .setContentText(notification.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notification.body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setNumber(lastBadge)
            .setPriority(
                if (NotificationMapping.isHighImportance(notification)) {
                    NotificationCompat.PRIORITY_HIGH
                } else {
                    NotificationCompat.PRIORITY_DEFAULT
                },
            )
            .setCategory(
                if (notification.isBlocking) NotificationCompat.CATEGORY_ALARM
                else NotificationCompat.CATEGORY_STATUS,
            )
        manager.notify(NotificationMapping.dedupeId(notification, sequence), 0, builder.build())
    }

    override fun setBadge(count: Int) {
        // No universal launcher-badge API without a posted notification. Unread
        // count is attached via setNumber on real notify posts; badge-only updates
        // are a no-op so we never leave a phantom notification in the shade.
        lastBadge = maxOf(0, count)
    }

    @Volatile
    var lastBadge: Int = 0
        private set

    fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val system = appContext.getSystemService(NotificationManager::class.java) ?: return
        val blocking = NotificationChannel(
            NotificationMapping.CHANNEL_BLOCKING,
            appContext.getString(R.string.notification_channel_blocking),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = appContext.getString(R.string.notification_channel_blocking_desc)
        }
        val done = NotificationChannel(
            NotificationMapping.CHANNEL_DONE,
            appContext.getString(R.string.notification_channel_done),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = appContext.getString(R.string.notification_channel_done_desc)
        }
        val routine = NotificationChannel(
            NotificationMapping.CHANNEL_ROUTINE_FAILED,
            appContext.getString(R.string.notification_channel_routine),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = appContext.getString(R.string.notification_channel_routine_desc)
        }
        system.createNotificationChannels(listOf(blocking, done, routine))
    }

    /** True when the platform will accept a notification post right now. */
    fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** True when a runtime POST_NOTIFICATIONS request is still required. */
    fun needsNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT >= 33 && !canPost()

    companion object {
        const val EXTRA_THREAD_ID = "openmaus.threadId"
        const val EXTRA_BOT_ID = "openmaus.botId"
        const val EXTRA_KIND = "openmaus.kind"

        /** Permission string for the UI pass's launcher contract. */
        const val POST_NOTIFICATIONS_PERMISSION = Manifest.permission.POST_NOTIFICATIONS
    }
}

