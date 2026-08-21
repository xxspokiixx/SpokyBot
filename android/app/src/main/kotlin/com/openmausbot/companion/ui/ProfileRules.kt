package com.openmausbot.companion.ui

import com.openmausbot.companion.core.AvatarCrop
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotProfilePatch
import com.openmausbot.companion.core.ConfigStatus
import com.openmausbot.companion.core.Voice

/**
 * The paired-safe agent profile, as rules — the decision half of
 * `ios/App/AgentProfileView.swift`.
 *
 * Identity, avatar, notifications and voice preferences, and nothing else: the
 * shared provider keys stay on the computer, so this form has no field that
 * could carry one.
 */
data class ProfileForm(
    val name: String,
    val title: String,
    val description: String,
    val notifications: Boolean,
    val crop: AvatarCrop,
    /** Empty is the server's "use the workspace default", not "no value". */
    val voice: String,
    val speakReplies: Boolean,
) {
    companion object {
        /** `ProfileFormSnapshot(bot:)`, and the initial value of every field. */
        fun of(bot: Bot): ProfileForm = ProfileForm(
            name = bot.name,
            title = bot.title,
            description = bot.description,
            notifications = bot.notifications,
            crop = bot.avatarCrop ?: AvatarCrop.MASCOT,
            voice = bot.voice ?: "",
            speakReplies = bot.speakReplies == true,
        )
    }
}

/** One row of the voice picker. */
data class VoiceChoice(
    val id: String,
    val label: String,
    val detail: String?,
    val enabled: Boolean,
)

object ProfileRules {
    /** `String(prompt.trimming….prefix(400))` in `generateImage`. */
    const val GENERATE_PROMPT_LIMIT: Int = 400

    const val AVATAR_FOOTER: String =
        "PNG, JPEG, GIF, or WebP, up to 10 MB. Images are stored on your paired computer " +
            "and loaded with this phone's pairing token."

    const val GENERATE_READY_FOOTER: String =
        "Generation uses the shared image provider configured on your computer. No provider " +
            "key is sent to or stored on this phone."

    const val GENERATE_BLOCKED_FOOTER: String =
        "To generate images, configure the shared image provider in OpenMausBot on your " +
            "computer. Provider keys cannot be added from a phone."

    const val TTS_UNCONFIGURED: String = "ElevenLabs is not configured"

    // iOS ends this sentence with "never returned to iOS"; the platform word is
    // the only edit, for the same reason SettingsPolicy does not offer to open
    // iPhone Settings.
    const val VOICE_UNCONFIGURED_FOOTER: String =
        "Add the shared ElevenLabs key in this agent's profile on the computer. The key is " +
            "never returned to this phone."

    const val VOICE_NO_DEFAULT_FOOTER: String =
        "No workspace default voice is selected. Choose an agent-specific voice above; " +
            "synthesis still uses the shared ElevenLabs key on your computer."

    const val VOICE_READY_FOOTER: String =
        "The voice choice belongs to this agent. Workspace default uses the shared voice " +
            "selected on your computer."

    const val PICK_A_VOICE: String = "Pick a voice for this agent before enabling speech."

    const val PREVIEW_REFUSED: String =
        "Pick an agent voice or configure a workspace default on your computer first."

    /**
     * Only the fields the sheet owns and the user changed.
     *
     * Dirtiness compares the field as typed; the value sent is trimmed. That is
     * how the Swift reads, and it means a trailing space submits a field whose
     * trimmed value is unchanged — mirrored rather than tidied.
     *
     * The 100/200/4000 server limits are deliberately not re-applied here: the
     * shared contract owns them, and a narrower client limit would silently
     * truncate a profile written on the desktop.
     */
    fun patch(form: ProfileForm, baseline: ProfileForm, config: ConfigStatus?): BotProfilePatch {
        val savedSpeakReplies = config
            ?.let { it.canSpeak(form.voice) && form.speakReplies }
            ?: form.speakReplies
        return BotProfilePatch(
            name = if (form.name == baseline.name) null else form.name.trim(),
            title = if (form.title == baseline.title) null else form.title.trim(),
            description = if (form.description == baseline.description) {
                null
            } else {
                form.description.trim()
            },
            notifications = if (form.notifications == baseline.notifications) {
                null
            } else {
                form.notifications
            },
            avatarCrop = if (form.crop == baseline.crop) null else form.crop,
            voice = if (form.voice == baseline.voice) null else form.voice,
            speakReplies = if (savedSpeakReplies == baseline.speakReplies) {
                null
            } else {
                savedSpeakReplies
            },
        )
    }

    fun canSave(form: ProfileForm, busy: Boolean): Boolean =
        !busy && form.name.trim().isNotEmpty()

    fun imageGenerationReady(config: ConfigStatus?): Boolean = config?.imageGen?.configured == true

    fun canGenerate(busy: Boolean, config: ConfigStatus?, prompt: String): Boolean =
        !busy && imageGenerationReady(config) && prompt.trim().isNotEmpty()

    fun generatePrompt(raw: String): String = raw.trim().take(GENERATE_PROMPT_LIMIT)

    fun generateFooter(config: ConfigStatus?): String =
        if (imageGenerationReady(config)) GENERATE_READY_FOOTER else GENERATE_BLOCKED_FOOTER

    /** `config?.canSpeak(agentVoice:) == true` — false while the status is unknown. */
    fun selectedVoiceCanSpeak(config: ConfigStatus?, voice: String): Boolean =
        config?.canSpeak(voice) == true

    fun canPreview(busy: Boolean, config: ConfigStatus?, voice: String): Boolean =
        !busy && selectedVoiceCanSpeak(config, voice)

    /**
     * The voice section is only drawn when the shared key exists; without it the
     * phone has nothing honest to offer, and no field that could add one.
     */
    fun voiceConfigured(config: ConfigStatus?): Boolean = config?.isTTSConfigured == true

    fun voiceFooter(config: ConfigStatus?): String = when {
        !voiceConfigured(config) -> VOICE_UNCONFIGURED_FOOTER
        config?.hasWorkspaceDefaultVoice != true -> VOICE_NO_DEFAULT_FOOTER
        else -> VOICE_READY_FOOTER
    }

    /** The hint under the toggle, shown only when nothing can speak yet. */
    fun showsPickAVoice(config: ConfigStatus?, voice: String): Boolean =
        config?.hasWorkspaceDefaultVoice != true && voice.isEmpty()

    /**
     * The picker's rows, in the Swift's order: the empty tag first — usable only
     * when a workspace default actually exists — then the agent's current voice
     * if the list does not carry it, then the listed voices.
     */
    fun voiceChoices(config: ConfigStatus?, voices: List<Voice>, voice: String): List<VoiceChoice> {
        val out = mutableListOf<VoiceChoice>()
        out += if (config?.hasWorkspaceDefaultVoice == true) {
            VoiceChoice(id = "", label = "Workspace default", detail = null, enabled = true)
        } else {
            VoiceChoice(id = "", label = "Choose an agent voice", detail = null, enabled = false)
        }
        if (voice.isNotEmpty() && voices.none { it.id == voice }) {
            out += VoiceChoice(id = voice, label = "Current agent voice", detail = null, enabled = true)
        }
        voices.forEach { out += VoiceChoice(id = it.id, label = it.label, detail = it.description, enabled = true) }
        return out
    }

    /**
     * What the loaded status does to the form: a stored `speakReplies` that
     * nothing can speak is turned off before the user ever sees the toggle.
     */
    fun applyLoadedConfig(form: ProfileForm, config: ConfigStatus?): ProfileForm =
        if (config != null && !config.canSpeak(form.voice)) form.copy(speakReplies = false) else form

    fun cropLabel(crop: AvatarCrop): String = when (crop) {
        AvatarCrop.MASCOT -> "Mascot"
        AvatarCrop.CIRCLE -> "Circle"
        AvatarCrop.ROUNDED -> "Rounded"
        AvatarCrop.SQUARE -> "Square"
    }
}
