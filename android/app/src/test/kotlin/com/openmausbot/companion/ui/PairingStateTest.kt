package com.openmausbot.companion.ui

import androidx.compose.runtime.saveable.SaverScope
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.PairingInvite
import com.openmausbot.companion.core.PairingRouteError
import com.openmausbot.companion.discovery.DiscoveredService
import com.openmausbot.companion.discovery.toConnection
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
    fun `the saved form never contains the credential code or request id`() {
        val secrets = PairingSecretStore()
        val pending = scanned(secrets)
        secrets.setCode(pending.handle, "123456")
        val requestId = secrets.pairRequestId(pending.handle)!!

        val encoded = saved(pending)
        assertTrue(encoded != null && encoded.isNotEmpty())
        assertFalse(encoded!!.contains(credential), "the credential reached saved state: $encoded")
        assertFalse(encoded.contains("omb_pair_"), "a credential prefix reached saved state: $encoded")
        assertFalse(encoded.contains("123456"), "the six-digit code reached saved state: $encoded")
        assertFalse(encoded.contains(requestId), "the pair request id reached saved state: $encoded")
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
    fun `route retry keeps the request id and an authoritative retry replaces it`() {
        val secrets = PairingSecretStore()
        val handle = secrets.open(credential)
        val first = secrets.pairRequestId(handle)
        assertEquals(first, secrets.pairRequestId(handle))

        secrets.setCode(handle, "123456")
        secrets.resetAttempt(handle)
        assertNotEquals(first, secrets.pairRequestId(handle))
        assertEquals("", secrets.code(handle))
    }

    @Test
    fun `clear wipes both secrets`() {
        val secrets = PairingSecretStore()
        val handle = secrets.open(credential)
        secrets.setCode(handle, "123456")
        secrets.clear()
        assertNull(secrets.credential(handle))
        assertEquals("", secrets.code(handle))
        assertNull(secrets.pairRequestId(handle))
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

class PairingFailureDispositionTest {
    @Test
    fun `route failure retains either kind of in-memory attempt`() {
        val error = PairingRouteError(listOf("https://mac.example"))
        assertEquals(
            PairingFailureDisposition.RETAIN_ATTEMPT,
            pairingFailureDisposition(error, cameFromScanner = true),
        )
        assertEquals(
            PairingFailureDisposition.RETAIN_ATTEMPT,
            pairingFailureDisposition(error, cameFromScanner = false),
        )
    }

    @Test
    fun `authoritative failure drops qr but only resets a typed code`() {
        val error = IllegalStateException("pairing rejected")
        assertEquals(
            PairingFailureDisposition.DROP_SCANNED_ATTEMPT,
            pairingFailureDisposition(error, cameFromScanner = true),
        )
        assertEquals(
            PairingFailureDisposition.RESET_TYPED_ATTEMPT,
            pairingFailureDisposition(error, cameFromScanner = false),
        )
    }
}

/**
 * The confirmation, read against `confirmationView(for:)` in
 * `ios/App/PairingView.swift`.
 *
 * The expectations here come from the Swift, not from the Kotlin they check.
 * Two things are load-bearing there:
 *
 *  - `Text(connection.name)` and `Text(connection.displayAddress)`
 *    sit **above** `if let credential = scannedCredential`, so both are on
 *    screen before confirming a scan *and* before typing six digits.
 *  - the scanned branch reads: "Confirm this computer to establish an
 *    authenticated companion connection. Use a trusted Wi-Fi network or a
 *    tailnet; OpenMausBot does not encrypt local Wi-Fi traffic." Authenticated
 *    and encrypted are different claims, and only one of them is true of the
 *    local network.
 */
class PairingConfirmationTest {
    private val connection = Connection(
        id = "conn-1",
        name = "Kesley's Ubuntu",
        host = "192.168.1.42",
        port = 8810,
    )

    private val credential = "omb_pair_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg"

    private fun scanned(secrets: PairingSecretStore) =
        PendingPairing(connection, fromScan = true, handle = secrets.open(credential))

    private fun typed(secrets: PairingSecretStore) =
        PendingPairing(connection, fromScan = false, handle = secrets.open())

    @Test
    fun `a scanned computer is confirmed by name and address`() {
        val secrets = PairingSecretStore()
        val confirmation = PairingConfirmation.of(scanned(secrets), secrets)

        assertEquals("Kesley's Ubuntu", confirmation.name)
        assertEquals("192.168.1.42", confirmation.address)
        assertEquals(
            PairingConfirmation.Step.Confirm(credential),
            confirmation.step,
        )
    }

    @Test
    fun `a discovered or typed computer shows the same name and address`() {
        // The gap this pass closes: the six-digit path used to show the name as a
        // section title and never repeat the address.
        val secrets = PairingSecretStore()
        val confirmation = PairingConfirmation.of(typed(secrets), secrets)

        assertEquals("Kesley's Ubuntu", confirmation.name)
        assertEquals("192.168.1.42", confirmation.address)
        assertEquals(PairingConfirmation.Step.EnterCode, confirmation.step)
    }

    @Test
    fun `a scan that outlived its credential still names the computer and address`() {
        val restarted = PairingSecretStore()
        val restored = PendingPairing(connection, fromScan = true, handle = "handle-from-a-dead-process")
        val confirmation = PairingConfirmation.of(restored, restarted)

        assertEquals(PairingConfirmation.Step.Rescan, confirmation.step)
        assertEquals("Kesley's Ubuntu", confirmation.name)
        assertEquals("192.168.1.42", confirmation.address)
    }

    @Test
    fun `no step of the confirmation is reachable without a name and an address`() {
        val secrets = PairingSecretStore()
        val every = listOf(
            PairingConfirmation.of(scanned(secrets), secrets),
            PairingConfirmation.of(typed(PairingSecretStore()), PairingSecretStore()),
            PairingConfirmation.of(
                PendingPairing(connection, fromScan = true, handle = "orphan"),
                PairingSecretStore(),
            ),
        )
        assertEquals(
            listOf(
                PairingConfirmation.Step.Confirm(credential),
                PairingConfirmation.Step.EnterCode,
                PairingConfirmation.Step.Rescan,
            ),
            every.map { it.step },
            "the three steps of confirmationView(for:) are not all covered",
        )
        for (confirmation in every) {
            assertTrue(confirmation.name.isNotBlank(), "a step with no name: ${confirmation.step}")
            assertEquals(
                connection.displayAddress,
                confirmation.address,
                "a step without a display authority: ${confirmation.step}",
            )
            assertTrue(confirmation.notice.isNotBlank(), "a step with no notice: ${confirmation.step}")
        }
    }

    @Test
    fun `a computer that never told us its name is headed by its address`() {
        val secrets = PairingSecretStore()
        val nameless = PendingPairing(
            connection = connection.copy(name = "  "),
            fromScan = false,
            handle = secrets.open(),
        )
        val confirmation = PairingConfirmation.of(nameless, secrets)
        assertEquals("192.168.1.42", confirmation.name)
        assertEquals("192.168.1.42", confirmation.address)
    }

    @Test
    fun `an IPv6 computer keeps its brackets in the address`() {
        val secrets = PairingSecretStore()
        val ipv6 = PendingPairing(
            connection = Connection(name = "fe80", host = "[fe80::1]", port = 8810),
            fromScan = false,
            handle = secrets.open(),
        )
        assertEquals("[fe80::1]", PairingConfirmation.of(ipv6, secrets).address)
    }

    @Test
    fun `a hosted scan shows the complete HTTPS authority and HTTPS notice`() {
        val secrets = PairingSecretStore()
        val hosted = requireNotNull(Connection.parse("https://mac.example:9443")).copy(name = "Hosted Mac")
        val pending = PendingPairing(hosted, fromScan = true, handle = secrets.open(credential))

        val confirmation = PairingConfirmation.of(pending, secrets)

        assertEquals("https://mac.example:9443", confirmation.address)
        assertTrue(confirmation.notice.contains("authenticated HTTPS companion connection"))
        assertFalse(confirmation.notice.contains("does not encrypt"))
    }

    @Test
    fun `the scanned notice says authenticated and says the local network is not encrypted`() {
        val notice = PairingCopy.CONFIRM_SCAN
        // The clauses of the Swift line, each carrying its own claim.
        assertTrue(notice.contains("authenticated companion connection"), notice)
        assertTrue(notice.contains("trusted Wi-Fi"), notice)
        assertTrue(notice.contains("tailnet"), notice)
        assertTrue(notice.contains("does not encrypt local Wi-Fi traffic"), notice)
        // And it still asks the question a scan must never answer for the user.
        assertTrue(notice.contains("Only continue if this is the computer"), notice)
    }

    @Test
    fun `the scanned notice no longer talks about what the phone gains instead`() {
        // The copy this replaces listed the phone's new powers and left the
        // transport unmentioned, which is the half that matters on a shared LAN.
        val notice = PairingCopy.CONFIRM_SCAN
        assertFalse(notice.contains("answer approvals"), notice)
        assertFalse(notice.contains("send work"), notice)
    }

    @Test
    fun `the six-digit step asks for the code the desktop is showing`() {
        // `PairingView.swift`: "Enter the 6-digit code shown on your desktop:".
        val notice = PairingCopy.ENTER_CODE
        assertTrue(notice.contains("6-digit code"), notice)
        assertTrue(notice.contains("desktop"), notice)
    }

    @Test
    fun `a QR or deep link without an address never becomes a pending pairing`() {
        assertNull(PairingInvite.parse("openmausbot://pair?token=$credential"))
        // The control: with one, the invite carries a host and a port.
        val invite = PairingInvite.parse(
            "openmausbot://pair?address=192.168.1.42:8810&name=Kesley%27s%20Ubuntu&token=$credential",
        )
        assertEquals("192.168.1.42", invite?.connection?.host)
        assertEquals(8810, invite?.connection?.port)
    }

    @Test
    fun `a typed address that is not one never becomes a pending pairing`() {
        assertNull(Connection.parse(""))
        assertNull(Connection.parse("   "))
        assertNull(Connection.parse("http://"))
        assertNull(Connection.parse("192.168.1.42:not-a-port"))
        assertEquals(8810, Connection.parse("192.168.1.42")?.port)
    }

    @Test
    fun `a discovered service that answered without an address is refused`() {
        assertNull(DiscoveredService(name = "Kesley's Ubuntu", host = null, port = 8810).toConnection())
        assertNull(DiscoveredService(name = "Kesley's Ubuntu", host = "192.168.1.42", port = null).toConnection())
        // The control: a resolved one carries both, so the confirmation can open.
        val resolved = DiscoveredService(name = "Kesley's Ubuntu", host = "192.168.1.42", port = 8810)
            .toConnection()
        assertEquals("192.168.1.42", resolved?.host)
        assertEquals(8810, resolved?.port)
    }
}
