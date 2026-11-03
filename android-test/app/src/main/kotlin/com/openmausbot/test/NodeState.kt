package com.openmausbot.test

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

object NodeState {
    enum class Phase { Idle, Extracting, BundleMissing, RuntimeMissing, Starting, Running, Ready, Failed, Stopped }

    data class Status(
        val phase: Phase = Phase.Idle,
        val detail: String = "",
        val logTail: String = "",
        val healthJson: String = "",
        val paired: Boolean = false,
    )

    val status = MutableStateFlow(Status())

    fun update(
        phase: Phase = status.value.phase,
        detail: String = status.value.detail,
        logTail: String = status.value.logTail,
        healthJson: String = status.value.healthJson,
        paired: Boolean = status.value.paired,
    ) {
        status.update { Status(phase, detail, logTail, healthJson, paired) }
    }

    fun samePhase(vararg phases: Phase): Boolean = status.value.phase in phases
}