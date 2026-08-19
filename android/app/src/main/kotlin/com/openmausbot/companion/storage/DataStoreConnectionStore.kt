package com.openmausbot.companion.storage

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.openmausbot.companion.core.CompanionJson
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.ConnectionStore
import kotlinx.coroutines.flow.first
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

private val Context.connectionDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "companion_connection",
)

class DataStoreConnectionStore(
    private val dataStore: DataStore<Preferences>,
) : ConnectionStore {
    constructor(context: Context) : this(context.applicationContext.connectionDataStore)

    override suspend fun load(): Connection? {
        val raw = dataStore.data.first()[KEY] ?: return null
        return runCatching { CompanionJson.decodeFromString<Connection>(raw) }.getOrNull()
    }

    override suspend fun save(connection: Connection) {
        val encoded = CompanionJson.encodeToString(connection)
        dataStore.edit { prefs -> prefs[KEY] = encoded }
    }

    override suspend fun clear() {
        dataStore.edit { prefs -> prefs.remove(KEY) }
    }

    companion object {
        val KEY = stringPreferencesKey("companion.connection")
    }
}
