package com.openmausbot.companion.ui

import androidx.compose.runtime.saveable.Saver
import com.openmausbot.companion.core.CompanionJson
import com.openmausbot.companion.core.Connection
import java.util.UUID
import kotlinx.serialization.Serializable

/**
 * The one-time pairing secrets — the QR credential and the six-digit code — held
 * in process memory and nowhere else.
 *
 * §6 is explicit: *never persist the QR credential or the code*. Only the
 * long-lived device token is written down. Saved instance state does not count
 * as memory for this purpose — the system holds those Bundles across a
 * process kill, which is exactly how `rememberSaveable` survives one — so
 * nothing here may ever be handed to a `Saver`.
 *
 * The consequence is the behaviour we want anyway. A rotation keeps the same
 * process, so this store still holds the credential and the confirmation screen
 * carries on. A restore after the system killed the app gets a fresh, empty
 * store, so the credential is simply gone — which is the honest answer, because
 * `Session`'s spent-credential set died with the process too and nothing left
 * can say whether that token was already redeemed. Retrying one that may have
 * reached the computer can mint a second device record.
 *
 * One pending pairing at a time, so one slot. [open] replaces whatever was there.
 */
internal class PairingSecretStore {
    private var handle: String? = null
    private var credential: String? = null
    private var code: String = ""

    /**
     * Begin a pending pairing and return its handle — a random, non-secret id
     * that is safe to put in saved state and means nothing without this store.
     */
    @Synchronized
    fun open(credential: String? = null): String {
        val minted = UUID.randomUUID().toString()
        handle = minted
        this.credential = credential
        this.code = ""
        return minted
    }

    /** True when this store is the one that minted [handle] and still holds it. */
    @Synchronized
    fun owns(handle: String?): Boolean = handle != null && handle == this.handle

    /** The scanned credential, or null once the process that scanned it is gone. */
    @Synchronized
    fun credential(handle: String?): String? = if (owns(handle)) credential else null

    @Synchronized
    fun code(handle: String?): String = if (owns(handle)) code else ""

    @Synchronized
    fun setCode(handle: String?, value: String) {
        if (owns(handle)) code = value
    }

    @Synchronized
    fun clear() {
        handle = null
        credential = null
        code = ""
    }
}

/** Process-wide instance: a class initialiser runs once per process. */
internal val PairingSecrets = PairingSecretStore()

/**
 * The computer the user is about to pair with, held while they confirm it.
 *
 * Deliberately carries **no secret**: a connection, whether it came from a scan,
 * and the [handle] that finds the secrets in [PairingSecretStore]. This is the
 * part that is safe to put in saved instance state.
 */
@Serializable
internal data class PendingPairing(
    val connection: Connection,
    /** True when this came from a QR or deep link rather than the list or a typed address. */
    val fromScan: Boolean,
    val handle: String,
)

/** The scanned credential for this pairing, if this process is still the one holding it. */
internal fun PendingPairing.credential(secrets: PairingSecretStore = PairingSecrets): String? =
    secrets.credential(handle)

/**
 * True when a scanned pairing has outlived its credential and the user must
 * rescan rather than retry something that may already have been redeemed.
 */
internal fun PendingPairing.needsRescan(secrets: PairingSecretStore = PairingSecrets): Boolean =
    fromScan && secrets.credential(handle) == null

/**
 * A pending pairing restored into a store that never knew it — the shape of a
 * process restart, where saved state came back and the secrets did not.
 *
 * A typed or discovered computer is given a fresh slot, because there is nothing
 * to recover and the user is about to type six digits that have to be written
 * down somewhere the next rotation can find them. A scanned one is left alone:
 * minting a slot cannot bring the credential back, and it is the rescan case.
 */
internal fun PendingPairing.rebindingIfOrphaned(
    secrets: PairingSecretStore = PairingSecrets,
): PendingPairing =
    if (!fromScan && !secrets.owns(handle)) copy(handle = secrets.open()) else this

/**
 * Through saved instance state. `Connection` is already `@Serializable` for the
 * connection store, so one encoding serves both and there is no second shape of
 * the record to keep in step. Nothing secret passes through here.
 */
internal val PendingPairingSaver: Saver<PendingPairing?, String> = Saver(
    save = { pending ->
        pending?.let { CompanionJson.encodeToString(PendingPairing.serializer(), it) }
    },
    restore = { encoded ->
        runCatching { CompanionJson.decodeFromString(PendingPairing.serializer(), encoded) }
            .getOrNull()
    },
)
