package com.openmausbot.companion.core

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

class CandidateRotation(val hosts: List<String>) {
    private var index = 0

    val current: String get() = hosts.getOrNull(index).orEmpty()
    val count: Int get() = hosts.size

    fun advance(): String {
        if (hosts.isEmpty()) return ""
        index = (index + 1) % hosts.size
        return current
    }

    fun promoted(): List<String> {
        val winner = hosts.getOrNull(index) ?: return hosts
        return listOf(winner) + hosts.filterIndexed { candidateIndex, _ -> candidateIndex != index }
    }
}

enum class ConnectionFailure {
    CANNOT_FIND_HOST,
    CANNOT_CONNECT_TO_HOST,
    TIMED_OUT,
    SECURE_CONNECTION_FAILED,
    NOT_CONNECTED_TO_INTERNET,
    CANCELLED,
    NETWORK_CONNECTION_LOST,
    OTHER,
}

object ConnectionAdvice {
    fun shouldTryAnotherHost(failure: ConnectionFailure): Boolean = failure in setOf(
        ConnectionFailure.CANNOT_FIND_HOST,
        ConnectionFailure.CANNOT_CONNECT_TO_HOST,
        ConnectionFailure.TIMED_OUT,
        ConnectionFailure.SECURE_CONNECTION_FAILED,
    )

    fun shouldTryAnotherHost(error: Throwable): Boolean = when (error) {
        is APIError.Transport -> error.cause?.let(::shouldTryAnotherHost) ?: false
        is UnknownHostException, is ConnectException, is SocketTimeoutException, is SSLException -> true
        else -> false
    }

    fun message(
        failure: ConnectionFailure,
        host: String,
        port: Int,
        tryingNext: String? = null,
    ): String {
        val advice = when (failure) {
            ConnectionFailure.CANNOT_FIND_HOST ->
                "“$host” didn't resolve. If that's a Tailscale name, this phone may not be on the tailnet."
            ConnectionFailure.CANNOT_CONNECT_TO_HOST ->
                "Reached your computer, but the companion isn't answering on port $port — open OpenMausBot → Settings → Companion."
            ConnectionFailure.TIMED_OUT ->
                "No route to your computer at $host — different network, or a firewall."
            ConnectionFailure.NOT_CONNECTED_TO_INTERNET -> "You're offline."
            else -> "Could not reach $host."
        }
        val fallback = tryingNext?.let { " Trying $it next." }.orEmpty()
        return advice + fallback + " The app keeps retrying automatically."
    }
}
