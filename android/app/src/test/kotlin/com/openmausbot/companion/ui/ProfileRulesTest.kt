package com.openmausbot.companion.ui

import com.openmausbot.companion.core.AvatarCrop
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.ConfigFlag
import com.openmausbot.companion.core.ConfigStatus
import com.openmausbot.companion.core.ModelSelection
import com.openmausbot.companion.core.Voice
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * D2-04 / D2-05 / D2-06: what the profile sheet decides.
 *
 * Every expectation is read off `ios/App/AgentProfileView.swift` — the dirty
 * comparison at `:181-205`, the section gating at `:47-151`, and the load-time
 * correction in the view's `.task`. Nothing here is read back out of the Kotlin
 * it is testing.
 */
class ProfileRulesTest {

    @Test
    fun `an untouched form patches nothing`() {
        val bot = bot()
        val form = ProfileForm.of(bot)
        val patch = ProfileRules.patch(form, ProfileForm.of(bot), config = speaking())

        assertNull(patch.name)
        assertNull(patch.title)
        assertNull(patch.description)
        assertNull(patch.notifications)
        assertNull(patch.avatarCrop)
        assertNull(patch.voice)
        assertNull(patch.speakReplies)
        // The narrow contract owns avatarUrl; the form never sends one.
        assertNull(patch.avatarUrl)
    }

    @Test
    fun `only the changed fields travel, and they travel trimmed`() {
        val baseline = ProfileForm.of(bot())
        val form = baseline.copy(name = "  Scout II  ", notifications = false)
        val patch = ProfileRules.patch(form, baseline, config = speaking())

        assertEquals("Scout II", patch.name)
        assertEquals(false, patch.notifications)
        assertNull(patch.title)
        assertNull(patch.description)
    }

    @Test
    fun `a trailing space alone still counts as changed`() {
        // iOS compares `name == baseline.name` before trimming, so whitespace
        // makes the field dirty and sends a value identical to the baseline.
        // Mirrored deliberately rather than tidied.
        val baseline = ProfileForm.of(bot())
        val patch = ProfileRules.patch(baseline.copy(name = "Scout "), baseline, speaking())

        assertEquals("Scout", patch.name)
    }

    @Test
    fun `the server owns the length limits`() {
        val baseline = ProfileForm.of(bot())
        val long = "n".repeat(500)
        val patch = ProfileRules.patch(baseline.copy(name = long), baseline, speaking())

        assertEquals(long, patch.name, "100/200/4000 belong to the shared contract")
    }

    @Test
    fun `empty voice is a value, not an omission`() {
        // The server reads "" as "use the workspace default"; nil would mean the
        // voice is not part of this patch at all.
        val baseline = ProfileForm.of(bot().copy(voice = "voice-7"))
        val patch = ProfileRules.patch(baseline.copy(voice = ""), baseline, speaking())

        assertEquals("", patch.voice)
    }

    @Test
    fun `speak replies is saved off when the selection cannot speak`() {
        val baseline = ProfileForm.of(bot().copy(speakReplies = true))
        val form = baseline.copy(voice = "")
        // Key configured, no workspace default, no agent voice: nothing to speak.
        val patch = ProfileRules.patch(form, baseline, config = configuredWithoutDefault())

        assertEquals(false, patch.speakReplies)
    }

    @Test
    fun `speak replies is left as typed while the status is unknown`() {
        val baseline = ProfileForm.of(bot())
        val patch = ProfileRules.patch(baseline.copy(speakReplies = true), baseline, config = null)

        assertEquals(true, patch.speakReplies)
    }

    @Test
    fun `a stored speak replies nothing can voice is turned off on load`() {
        val form = ProfileForm.of(bot().copy(speakReplies = true))

        assertFalse(ProfileRules.applyLoadedConfig(form, configuredWithoutDefault()).speakReplies)
        assertTrue(ProfileRules.applyLoadedConfig(form, speaking()).speakReplies)
        assertTrue(ProfileRules.applyLoadedConfig(form, null).speakReplies, "unknown changes nothing")
    }

    @Test
    fun `saving needs a name that is more than whitespace`() {
        val form = ProfileForm.of(bot())

        assertTrue(ProfileRules.canSave(form, busy = false))
        assertFalse(ProfileRules.canSave(form, busy = true))
        assertFalse(ProfileRules.canSave(form.copy(name = "   "), busy = false))
    }

    @Test
    fun `generation needs a configured provider and something to ask for`() {
        val ready = ConfigStatus(imageGen = ConfigFlag(configured = true))
        val blocked = ConfigStatus(imageGen = ConfigFlag(configured = false))

        assertTrue(ProfileRules.canGenerate(busy = false, config = ready, prompt = "a fox"))
        assertFalse(ProfileRules.canGenerate(busy = true, config = ready, prompt = "a fox"))
        assertFalse(ProfileRules.canGenerate(busy = false, config = ready, prompt = "  "))
        assertFalse(ProfileRules.canGenerate(busy = false, config = blocked, prompt = "a fox"))
        assertFalse(ProfileRules.canGenerate(busy = false, config = null, prompt = "a fox"))
    }

    @Test
    fun `the art direction is trimmed and capped at 400`() {
        assertEquals("a fox", ProfileRules.generatePrompt("  a fox\n"))
        assertEquals(400, ProfileRules.generatePrompt("x".repeat(900)).length)
    }

    @Test
    fun `the generate footer says which computer holds the provider key`() {
        assertEquals(
            ProfileRules.GENERATE_READY_FOOTER,
            ProfileRules.generateFooter(ConfigStatus(imageGen = ConfigFlag(configured = true))),
        )
        assertEquals(ProfileRules.GENERATE_BLOCKED_FOOTER, ProfileRules.generateFooter(null))
    }

    @Test
    fun `the voice section only appears once the shared key exists`() {
        assertFalse(ProfileRules.voiceConfigured(null))
        assertFalse(ProfileRules.voiceConfigured(ConfigStatus(tts = ConfigFlag(configured = false))))
        assertTrue(ProfileRules.voiceConfigured(ConfigStatus(tts = ConfigFlag(configured = true))))
        assertTrue(
            ProfileRules.voiceConfigured(
                ConfigStatus(tts = ConfigFlag(configured = false, apiKeyConfigured = true)),
            ),
            "either flag means the computer holds a key",
        )
    }

    @Test
    fun `the empty tag is only selectable when a workspace default exists`() {
        val withDefault = ProfileRules.voiceChoices(speaking(), voices(), voice = "")
        assertEquals("Workspace default", withDefault.first().label)
        assertTrue(withDefault.first().enabled)

        val without = ProfileRules.voiceChoices(configuredWithoutDefault(), voices(), voice = "")
        assertEquals("Choose an agent voice", without.first().label)
        assertFalse(without.first().enabled)
    }

    @Test
    fun `an agent voice the list does not carry keeps its own row`() {
        val choices = ProfileRules.voiceChoices(speaking(), voices(), voice = "retired-voice")

        assertEquals(
            listOf("", "retired-voice", "voice-1", "voice-2"),
            choices.map { it.id },
        )
        assertEquals("Current agent voice", choices[1].label)
        assertEquals("Warm", choices[2].detail)
        assertNull(choices[3].detail)
    }

    @Test
    fun `a listed agent voice does not get a duplicate row`() {
        val choices = ProfileRules.voiceChoices(speaking(), voices(), voice = "voice-2")

        assertEquals(listOf("", "voice-1", "voice-2"), choices.map { it.id })
    }

    @Test
    fun `speaking needs a key and something to speak with`() {
        assertFalse(ProfileRules.selectedVoiceCanSpeak(null, ""))
        assertFalse(ProfileRules.selectedVoiceCanSpeak(configuredWithoutDefault(), ""))
        assertTrue(ProfileRules.selectedVoiceCanSpeak(configuredWithoutDefault(), "voice-1"))
        assertTrue(ProfileRules.selectedVoiceCanSpeak(speaking(), ""))
        assertFalse(
            ProfileRules.selectedVoiceCanSpeak(
                ConfigStatus(tts = ConfigFlag(configured = false, voice = "shared")),
                "voice-1",
            ),
            "a default voice without a key still cannot speak",
        )
    }

    @Test
    fun `preview follows the same gate, plus busy`() {
        assertTrue(ProfileRules.canPreview(busy = false, config = speaking(), voice = ""))
        assertFalse(ProfileRules.canPreview(busy = true, config = speaking(), voice = ""))
        assertFalse(
            ProfileRules.canPreview(busy = false, config = configuredWithoutDefault(), voice = ""),
        )
    }

    @Test
    fun `the hint appears exactly when nothing can speak yet`() {
        assertTrue(ProfileRules.showsPickAVoice(configuredWithoutDefault(), ""))
        assertFalse(ProfileRules.showsPickAVoice(configuredWithoutDefault(), "voice-1"))
        assertFalse(ProfileRules.showsPickAVoice(speaking(), ""))
    }

    @Test
    fun `each voice footer answers the state it belongs to`() {
        assertEquals(ProfileRules.VOICE_UNCONFIGURED_FOOTER, ProfileRules.voiceFooter(null))
        assertEquals(
            ProfileRules.VOICE_NO_DEFAULT_FOOTER,
            ProfileRules.voiceFooter(configuredWithoutDefault()),
        )
        assertEquals(ProfileRules.VOICE_READY_FOOTER, ProfileRules.voiceFooter(speaking()))
    }

    @Test
    fun `the shape selector offers the four crops in the Swift's order`() {
        assertEquals(
            listOf("Mascot", "Circle", "Rounded", "Square"),
            AvatarCrop.entries.map(ProfileRules::cropLabel),
        )
    }

    @Test
    fun `the form starts from the bot the sheet was opened on`() {
        val form = ProfileForm.of(
            bot().copy(
                avatarCrop = AvatarCrop.ROUNDED,
                voice = "voice-2",
                speakReplies = true,
            ),
        )

        assertEquals("Scout", form.name)
        assertEquals(AvatarCrop.ROUNDED, form.crop)
        assertEquals("voice-2", form.voice)
        assertTrue(form.speakReplies)
    }

    @Test
    fun `a bot with no crop and no voice starts on mascot and the empty tag`() {
        val form = ProfileForm.of(bot())

        assertEquals(AvatarCrop.MASCOT, form.crop)
        assertEquals("", form.voice)
        assertFalse(form.speakReplies)
    }

    private fun voices() = listOf(
        Voice(id = "voice-1", label = "Aria", description = "Warm"),
        Voice(id = "voice-2", label = "Bex", description = null),
    )

    /** Key configured and a workspace default selected. */
    private fun speaking() =
        ConfigStatus(tts = ConfigFlag(configured = true, voice = "shared-voice"))

    /** Key configured, workspace default blank — the state that blocks speech. */
    private fun configuredWithoutDefault() =
        ConfigStatus(tts = ConfigFlag(configured = true, voice = "   "))

    private fun bot() = Bot(
        id = "bot-1",
        threadId = "task-1",
        name = "Scout",
        title = "research",
        description = "Finds things",
        notifications = true,
        color = "green",
        unread = false,
        modelSelection = ModelSelection("instance-1", "model-1"),
        createdAt = 0.0,
    )
}
