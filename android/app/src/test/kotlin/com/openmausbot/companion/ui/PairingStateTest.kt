package com.openmausbot.companion.ui

import androidx.compose.runtime.saveable.SaverScope
import com.openmausbot.companion.core.Connection
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * The pending pairing has to survive a rotation and must not survive the process,
 * and §6's "never persist the QR credential or code" has to hold literally: no
 * secret may reach a saved-state Bundle, because the system keeps those across a
 * process kill.
 *
 * A fresh [PairingSecretStore] in these tests stands for the store a restarted
 * process would get: empty.
 */
class PairingStateTest {
    private val scope = SaverScope { true }

    private val connection = Connection(
        id = "conn-1",
        name = "Kesley's Ubuntu",
        host = "192.168.1.42",
        port = 8810,
        hosts = listOf("192.168.1.42", "kes.tail1234.ts.net"),
    )

    private val credential = "omb_pair_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg"

    /** `Saver.save` is a member extension: both receivers have to be implicit. */
    private fun saved(pending: PendingPairing?): String? =
        with(PendingPairingSaver) { with(scope) { save(pending) } }

    private fun scanned(secrets: PairingSecretStore) = PendingPairing(
        connection = connection,
        fromScan = true,
        handle = secrets.open(credential),
    )

    @Test
    fun `the saved form never contains the credential or the code`() {
        val secrets = PairingSecretStore()
        val pending = scanned(secrets)
        secrets.setCode(pending.handle, "123456")

        val encoded = saved(pending)
        assertTrue(encoded != null && encoded.isNotEmpty())
        assertFalse(encoded!!.contains(credential), "the credential reached saved state: $encoded")
        assertFalse(encoded.contains("omb_pair_"), "a credential prefix reached saved state: $encoded")
        assertFalse(encoded.contains("123456"), "the six-digit code reached saved state: $encoded")
    }

    @Test
    fun `a rotation keeps the scanned credential`() {
        // Same process, so the same store answers for the restored handle.
        val secrets = PairingSecretStore()
        val pending = scanned(secrets)
        val restored = saved(pending)?.let(PendingPairingSaver::restore)

        assertEquals(pending, restored)
        assertEquals(credential, restored?.credential(secrets))
        assertFalse(restored!!.needsRescan(secrets))
    }

    @Test
    fun `a rotation keeps the typed six-digit code`() {
        val secrets = PairingSecretStore()
        val pending = PendingPairing(connection, fromScan = false, handle = secrets.open())
        secrets.setCode(pending.handle, "420691")

        val restored = saved(pending)?.let(PendingPairingSaver::restore)
        assertEquals("420691", secrets.code(restored?.handle))
    }

    @Test
    fun `a restore into a new process has no credential and asks for a rescan`() {
        val pending = scanned(PairingSecretStore())
        val restarted = PairingSecretStore()

        val restored = saved(pending)?.let(PendingPairingSaver::restore)
        assertNull(restored?.credential(restarted))
        assertTrue(restored!!.needsRescan(restarted))
        // The computer is still shown, so the reader knows what was being paired.
        assertEquals(connection, restored.connection)
    }

    @Test
    fun `a restore into a new process has no six-digit code either`() {
        val secrets = PairingSecretStore()
        val pending = PendingPairing(connection, fromScan = false, handle = secrets.open())
        secrets.setCode(pending.handle, "420691")

        assertEquals("", PairingSecretStore().code(pending.handle))
    }

    @Test
    fun `a typed code survives the rotation after a process restart`() {
        val original = PairingSecretStore()
        val pending = PendingPairing(connection, fromScan = false, handle = original.open())

        // Process death: saved state comes back, the secrets do not.
        val restarted = PairingSecretStore()
        val restored = saved(pending)?.let(PendingPairingSaver::restore)!!
        assertFalse(restarted.owns(restored.handle))
        assertEquals("", restarted.code(restored.handle))

        // The screen rebinds an orphaned typed pairing before accepting input,
        // so the digits land somewhere the next rotation can find them.
        val rebound = restored.rebindingIfOrphaned(restarted)
        assertNotEquals(restored.handle, rebound.handle)
        assertTrue(restarted.owns(rebound.handle))
        restarted.setCode(rebound.handle, "420691")

        // Rotate: saved state round-trips again inside the same process.
        val afterRotation = saved(rebound)?.let(PendingPairingSaver::restore)!!
        assertEquals(rebound.handle, afterRotation.handle)
        assertEquals("420691", restarted.code(afterRotation.handle))
        // And rebinding is a no-op now that the store owns it.
        assertSame(afterRotation, afterRotation.rebindingIfOrphaned(restarted))
    }

    @Test
    fun `a scanned pairing is never rebound`() {
        val restarted = PairingSecretStore()
        val restored = saved(scanned(PairingSecretStore()))
            ?.let(PendingPairingSaver::restore)!!
        // Minting a slot cannot bring the credential back, so it stays orphaned.
        assertSame(restored, restored.rebindingIfOrphaned(restarted))
        assertTrue(restored.needsRescan(restarted))
    }

    @Test
    fun `a typed or discovered computer never needs a rescan`() {
        val secrets = PairingSecretStore()
        val manual = PendingPairing(connection, fromScan = false, handle = secrets.open())
        assertFalse(manual.needsRescan(secrets))
        assertFalse(manual.needsRescan(PairingSecretStore()))
    }

    @Test
    fun `an IPv6 address keeps its bracket form`() {
        val secrets = PairingSecretStore()
        val ipv6 = PendingPairing(
            connection = Connection(name = "fe80", host = "[fe80::1%eth0]", port = 8810),
            fromScan = false,
            handle = secrets.open(),
        )
        assertEquals(
            "[fe80::1%eth0]",
            saved(ipv6)?.let(PendingPairingSaver::restore)?.connection?.host,
        )
    }

    @Test
    fun `nothing pending saves nothing`() {
        assertNull(saved(null))
    }

    @Test
    fun `a corrupt saved value restores to nothing rather than crashing`() {
        assertNull(PendingPairingSaver.restore("not json"))
    }
}

class PairingSecretStoreTest {
    private val credential = "omb_pair_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg"

    @Test
    fun `a handle only answers in the store that minted it`() {
        val secrets = PairingSecretStore()
        val handle = secrets.open(credential)
        assertEquals(credential, secrets.credential(handle))
        assertNull(PairingSecretStore().credential(handle))
    }

    @Test
    fun `a stale handle gets nothing`() {
        val secrets = PairingSecretStore()
        val first = secrets.open(credential)
        val second = secrets.open("omb_pair_second")
        assertNull(secrets.credential(first))
        assertEquals("omb_pair_second", secrets.credential(second))
    }

    @Test
    fun `opening a new pairing drops the previous code`() {
        val secrets = PairingSecretStore()
        val first = secrets.open()
        secrets.setCode(first, "111111")
        val second = secrets.open()
        assertEquals("", secrets.code(second))
    }

    @Test
    fun `clear wipes both secrets`() {
        val secrets = PairingSecretStore()
        val handle = secrets.open(credential)
        secrets.setCode(handle, "123456")
        secrets.clear()
        assertNull(secrets.credential(handle))
        assertEquals("", secrets.code(handle))
    }

    @Test
    fun `a null handle never matches`() {
        val secrets = PairingSecretStore()
        secrets.open(credential)
        assertNull(secrets.credential(null))
        assertEquals("", secrets.code(null))
    }

    @Test
    fun `writing a code through a stale handle is ignored`() {
        val secrets = PairingSecretStore()
        val stale = secrets.open()
        val current = secrets.open()
        secrets.setCode(stale, "999999")
        assertEquals("", secrets.code(current))
    }

    @Test
    fun `a pairing with no credential has none to give`() {
        val secrets = PairingSecretStore()
        assertNull(secrets.credential(secrets.open()))
    }
}
