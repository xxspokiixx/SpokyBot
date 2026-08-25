package com.openmausbot.companion.core

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FailoverTest {
    private val hosted = assertNotNull(
        CompanionEndpoint.create("https://mac.companion.example", CompanionEndpointKind.HOSTED, 0),
    )
    private val tailnet = assertNotNull(
        CompanionEndpoint.create("http://mac.tail1234.ts.net:8810", CompanionEndpointKind.TAILNET, 100),
    )
    private val lan = assertNotNull(
        CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 200),
    )
    private val bonjour = assertNotNull(
        CompanionEndpoint.create("http://openmausbot-aa.local:8810", CompanionEndpointKind.BONJOUR, 300),
    )

    @Test
    fun walksProtectedCandidatesInOrderAndWraps() {
        val rotation = CandidateRotation(listOf(hosted, tailnet))
        assertEquals(hosted, rotation.currentEndpoint)
        assertEquals(tailnet, rotation.advanceEndpoint())
        // Wrapping rather than giving up: the retry loop already backs off between laps,
        // and a network that comes back deserves another try at the front.
        assertEquals(hosted, rotation.advanceEndpoint())
    }

    @Test
    fun explicitLocalRouteCanUpgradeButNeverDowngradeAgain() {
        val rotation = CandidateRotation(listOf(lan, tailnet, bonjour))

        assertEquals(listOf(lan, tailnet), rotation.endpoints, "an unchosen local route is never automatic")
        assertEquals(tailnet, rotation.advanceEndpoint())
        assertEquals(listOf(tailnet), rotation.endpoints, "upgrading prunes the explicit cleartext route")
        assertEquals(tailnet, rotation.advanceEndpoint())
    }

    @Test
    fun protectedLegacyHostDoesNotRetainLanFallbacks() {
        val rotation = CandidateRotation.ofHosts(listOf("mac.tail1234.ts.net", "192.168.1.42"))
        assertEquals(listOf("mac.tail1234.ts.net"), rotation.promoted())
    }

    @Test
    fun promotesTheWorkingCandidateToTheFront() {
        val rotation = CandidateRotation(listOf(hosted, tailnet))
        rotation.advanceEndpoint()
        assertEquals(listOf(tailnet, hosted), rotation.promotedEndpoints())
    }

    @Test
    fun promotionWithoutAWalkChangesNothing() {
        val rotation = CandidateRotation(listOf(hosted, tailnet))
        assertEquals(listOf(hosted, tailnet), rotation.promotedEndpoints())
    }

    @Test
    fun survivesAnEmptyCandidateList() {
        val rotation = CandidateRotation(emptyList())
        assertEquals("", rotation.current)
        assertEquals("", rotation.advance())
        assertEquals(emptyList(), rotation.promoted())
        assertNull(rotation.currentEndpoint)
        assertNull(rotation.advanceEndpoint())
        assertEquals(emptyList(), CandidateRotation.ofHosts(emptyList()).promoted())
    }

    @Test
    fun typedProtectedRotationPreservesSchemesAndPorts() {
        val oddPort = assertNotNull(
            CompanionEndpoint.create("http://mac.tail1234.ts.net:9910", CompanionEndpointKind.TAILNET, 100),
        )
        val rotation = CandidateRotation(listOf(hosted, oddPort))

        assertEquals(hosted, rotation.currentEndpoint)
        assertEquals(oddPort, rotation.advanceEndpoint())
        assertEquals("http://mac.tail1234.ts.net:9910", rotation.currentEndpoint?.url)
        assertEquals(listOf(oddPort, hosted), rotation.promotedEndpoints())
        assertEquals(listOf("mac.tail1234.ts.net:9910", "https://mac.companion.example"), rotation.promoted())
    }

    @Test
    fun rotatesOnAddressFailuresAndNothingElse() {
        listOf(
            ConnectionFailure.CANNOT_FIND_HOST,
            ConnectionFailure.CANNOT_CONNECT_TO_HOST,
            ConnectionFailure.TIMED_OUT,
            ConnectionFailure.SECURE_CONNECTION_FAILED,
        ).forEach { assertTrue(ConnectionAdvice.shouldTryAnotherHost(it)) }
        listOf(
            ConnectionFailure.NOT_CONNECTED_TO_INTERNET,
            ConnectionFailure.CANCELLED,
            ConnectionFailure.NETWORK_CONNECTION_LOST,
        ).forEach { assertFalse(ConnectionAdvice.shouldTryAnotherHost(it)) }

        assertTrue(ConnectionAdvice.shouldTryAnotherHost(UnknownHostException()))
        assertTrue(ConnectionAdvice.shouldTryAnotherHost(ConnectException()))
        assertTrue(ConnectionAdvice.shouldTryAnotherHost(SocketTimeoutException()))
        assertTrue(ConnectionAdvice.shouldTryAnotherHost(SSLException("TLS")))
        assertTrue(ConnectionAdvice.shouldTryAnotherHost(APIError.Transport("wrapped", UnknownHostException())))
        assertFalse(ConnectionAdvice.shouldTryAnotherHost(APIError.Status(401)))
    }

    @Test
    fun certificateFailuresBelongToTheRouteNotThePairing() {
        // A certificate a tunnel presents is a property of that route: another advertised route
        // can repair it, exactly as the four URLError certificate codes do upstream.
        assertEquals(
            ConnectionFailure.SECURE_CONNECTION_FAILED,
            ConnectionAdvice.classify(CertificateException("untrusted root")),
        )
        assertTrue(
            ConnectionAdvice.shouldTryAnotherRoute(
                APIError.Transport("handshake", CertificateException("expired")),
            ),
        )
    }

    @Test
    fun rotatesPastTunnelGatewayFailuresButNotApplicationErrors() {
        listOf(502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530).forEach { code ->
            assertTrue(
                ConnectionAdvice.shouldTryAnotherRoute(APIError.Status(code)),
                "expected HTTP $code to move to another route",
            )
            assertEquals(code, ConnectionAdvice.gatewayStatus(APIError.Status(code)))
        }
        listOf(400, 401, 403, 404, 409, 500, 501).forEach { code ->
            assertFalse(
                ConnectionAdvice.shouldTryAnotherRoute(APIError.Status(code)),
                "expected HTTP $code to stay on the current route",
            )
            assertNull(ConnectionAdvice.gatewayStatus(APIError.Status(code)))
        }
    }

    @Test
    fun tunnelGatewayFailureNeverAdvancesFromHostedToLan() {
        val rotation = CandidateRotation(listOf(hosted, lan))

        assertNull(rotation.advanceEndpoint(APIError.Status(502)))
        assertEquals(hosted, rotation.currentEndpoint)
        assertEquals(listOf(hosted), rotation.endpoints)
    }

    @Test
    fun tunnelGatewayFailureAdvancesToTheNextProtectedRoute() {
        val rotation = CandidateRotation(listOf(hosted, tailnet, lan))

        assertEquals(tailnet, rotation.advanceEndpoint(APIError.Status(522)))
    }

    @Test
    fun authenticationFailureDoesNotAdvanceTheRoute() {
        val rotation = CandidateRotation(listOf(hosted, tailnet))

        assertNull(rotation.advanceEndpoint(APIError.Status(401)))
        assertEquals(hosted, rotation.currentEndpoint)
    }

    @Test
    fun unresolvedHostNamesTheTailnetPossibility() {
        val message = ConnectionAdvice.message(
            ConnectionFailure.CANNOT_FIND_HOST,
            "mac.tail1234.ts.net",
            8810,
        )
        assertTrue(message.contains("mac.tail1234.ts.net"))
        assertTrue(message.contains("tailnet"))
        assertTrue(message.contains("retrying automatically"))
    }

    @Test
    fun refusedConnectionPointsAtTheCompanionToggle() {
        val message = ConnectionAdvice.message(
            ConnectionFailure.CANNOT_CONNECT_TO_HOST,
            "192.168.1.42",
            8810,
        )
        assertTrue(message.contains("port 8810"))
        assertTrue(message.contains("Settings → Companion"))
    }

    @Test
    fun timeoutBlamesTheRouteNotTheApp() {
        val message = ConnectionAdvice.message(ConnectionFailure.TIMED_OUT, "192.168.1.42", 8810)
        assertTrue(message.contains("No route"))
        assertTrue(message.contains("firewall"))
    }

    @Test
    fun offlineSaysOffline() {
        assertTrue(
            ConnectionAdvice.message(ConnectionFailure.NOT_CONNECTED_TO_INTERNET, "x", 8810)
                .contains("You're offline."),
        )
    }

    @Test
    fun adviceNamesTheCandidateBeingTriedNext() {
        val message = ConnectionAdvice.message(
            ConnectionFailure.CANNOT_FIND_HOST,
            "mac.tail1234.ts.net",
            8810,
            tryingNext = "192.168.1.42",
        )
        assertTrue(message.contains("Trying 192.168.1.42 next."))
    }

    @Test
    fun gatewayAdviceNamesTheFallbackRoute() {
        val message = ConnectionAdvice.message(
            gatewayStatus = 502,
            host = "https://mac.companion.example",
            tryingNext = "mac.tail1234.ts.net",
        )
        assertTrue(message.contains("HTTP 502"))
        assertTrue(message.contains("temporarily unavailable"))
        assertTrue(message.contains("Trying mac.tail1234.ts.net next."))
        assertTrue(message.contains("retrying automatically"))

        // Without a fallback the banner does not invent one.
        assertFalse(
            ConnectionAdvice.message(gatewayStatus = 522, host = "https://mac.companion.example")
                .contains("Trying"),
        )
    }

    @Test
    fun orderedHostsLeadsWithStoredHostAndDeduplicates() {
        val connection = Connection(
            name = "Mac",
            host = "192.168.1.42",
            port = 8810,
            hosts = listOf("mac.tail1234.ts.net", "192.168.1.42", "openmausbot-aa.local"),
        )
        assertEquals(
            listOf("192.168.1.42", "mac.tail1234.ts.net", "openmausbot-aa.local"),
            connection.orderedHosts,
        )
    }

    @Test
    fun orderedHostsFallsBackToSingleStoredHost() {
        val connection = Connection(name = "Mac", host = "mac.tail1234.ts.net", port = 8810)
        assertEquals(listOf("mac.tail1234.ts.net"), connection.orderedHosts)
    }

    @Test
    fun dialingSwapsHostWithoutTouchingStoredOrder() {
        val connection = Connection(
            name = "Mac",
            host = "mac.tail1234.ts.net",
            port = 8810,
            hosts = listOf("mac.tail1234.ts.net", "192.168.1.42"),
        )
        val dialed = connection.dialing("192.168.1.42")
        assertEquals("192.168.1.42", dialed.host)
        assertEquals("http://192.168.1.42:8810", dialed.baseUrl.toString())
        assertEquals(connection.hosts, dialed.hosts)
        assertEquals(connection.id, dialed.id)
    }

    @Test
    fun legacyFailoverCannotClobberAProtectedEndpointWithLocalCleartext() {
        val connection = requireNotNull(Connection.parse("https://mac.example")).copy(
            hosts = listOf("mac.example", "192.168.1.42"),
        )
        val explicitLocal = requireNotNull(
            CompanionEndpoint.direct("192.168.1.42", 8810, priority = 0),
        )

        assertEquals(connection, connection.dialing("192.168.1.42"))
        assertEquals(connection, connection.promoting("192.168.1.42"))
        assertEquals(explicitLocal, connection.promoting(explicitLocal).activeEndpoint)
    }

    @Test
    fun promoteReordersAndKeepsEveryCandidate() {
        val connection = Connection(
            name = "Mac",
            host = "mac.tail1234.ts.net",
            port = 8810,
            hosts = listOf("mac.tail1234.ts.net", "192.168.1.42", "openmausbot-aa.local"),
        ).promoting("192.168.1.42")
        assertEquals("192.168.1.42", connection.host)
        assertEquals(
            listOf("192.168.1.42", "mac.tail1234.ts.net", "openmausbot-aa.local"),
            connection.hosts,
        )
        val typed = connection.promoting("10.0.0.7")
        assertEquals("10.0.0.7", typed.hosts?.first())
        assertEquals(4, typed.hosts?.size)
    }

    @Test
    fun typedRoutesKeepHostedHttpsAheadOfAnActiveLanFallback() {
        val connection = Connection(
            name = "Mac",
            host = hosted.host,
            port = hosted.port,
            activeEndpoint = hosted,
            endpoints = listOf(lan, hosted),
        ).promoting(lan)

        assertEquals(lan.url, connection.baseUrl.toString())
        assertEquals(listOf(hosted.url, lan.url), connection.orderedEndpoints.map { it.url })
        assertEquals(listOf(hosted), connection.automaticEndpoints)
    }

    @Test
    fun promotingAWorkingLegacyEndpointKeepsEveryLegacyFallback() {
        val connection = Connection(
            name = "Mac",
            host = "mac.tail1234.ts.net",
            port = 8810,
            hosts = listOf("mac.tail1234.ts.net", "192.168.1.42", "openmausbot-aa.local"),
        ).promoting(assertNotNull(CompanionEndpoint.direct("192.168.1.42", 8810, priority = 1)))

        assertNull(connection.endpoints)
        assertEquals(
            listOf("192.168.1.42", "mac.tail1234.ts.net", "openmausbot-aa.local"),
            connection.orderedEndpoints.map { it.host },
        )
    }
}
