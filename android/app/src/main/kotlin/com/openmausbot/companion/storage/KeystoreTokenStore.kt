package com.openmausbot.companion.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.openmausbot.companion.core.TokenStore
import java.security.KeyStoreException
import javax.crypto.AEADBadTagException

/**
 * Keystore-backed device-token storage — iOS Keychain analogue.
 *
 * File name [PREFS_NAME] is excluded from Auto Backup and device-transfer via
 * `backup_rules.xml` / `data_extraction_rules.xml`. Keystore material is
 * ThisDeviceOnly-equivalent (not migratable).
 */
class KeystoreTokenStore(
    private val prefsProvider: () -> SharedPreferences,
) : TokenStore {
    constructor(context: Context) : this({ openPrefs(context.applicationContext) })

    private val prefs: SharedPreferences by lazy(prefsProvider)

    override suspend fun save(connectionId: String, token: String) {
        try {
            prefs.edit().putString(key(connectionId), token).apply()
        } catch (error: Exception) {
            throw TokenStoreException(locked = isLocked(error), cause = error)
        }
    }

    override suspend fun read(connectionId: String): TokenStore.ReadResult {
        return try {
            val value = prefs.getString(key(connectionId), null)
            if (value == null) TokenStore.ReadResult.Missing
            else TokenStore.ReadResult.Found(value)
        } catch (error: Exception) {
            TokenStore.ReadResult.Unavailable(
                locked = isLocked(error),
                message = error.message
                    ?: "Couldn't access the pairing securely.",
            )
        }
    }

    override suspend fun remove(connectionId: String) {
        runCatching { prefs.edit().remove(key(connectionId)).apply() }
    }

    private fun key(connectionId: String): String = "token.$connectionId"

    companion object {
        const val PREFS_NAME = "companion_device_token"

        fun openPrefs(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }

        private fun isLocked(error: Throwable): Boolean {
            val chain = generateSequence(error) { it.cause }.toList()
            return chain.any {
                it is KeyStoreException ||
                    it is AEADBadTagException ||
                    "User not authenticated" in (it.message.orEmpty()) ||
                    "keystore" in (it.message.orEmpty().lowercase()) &&
                    "locked" in (it.message.orEmpty().lowercase())
            }
        }
    }
}

class TokenStoreException(
    val locked: Boolean,
    cause: Throwable,
) : Exception(cause.message ?: "Couldn't access the pairing securely.", cause)
