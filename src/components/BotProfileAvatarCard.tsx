import { useState } from "react";
import { ChevronDown, ImagePlus, Loader2, Trash2 } from "lucide-react";

import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import {
  PICKABLE_STATES,
  MAUS_COLOR_LABEL,
  colorSwatch,
  MAUS_COLOR_NAMES,
  type MausMotion,
  type MausState,
} from "@/lib/mascot";
import { BOT_AVATAR_CROPS } from "../../shared/bot-avatar";
import { MASCOT_BODIES, MASCOT_BODY_IDS } from "../../shared/mascot-bodies";
import { HALLOWEEN_BODIES, HALLOWEEN_BODY_IDS } from "../../shared/halloween-bodies";
import { POKEMON_BODIES, POKEMON_BODY_IDS } from "../../shared/pokemon-bodies";
import { DIGIMON_SPRITES } from "../../shared/digimon-sprites";
import { isPokemonBody, type BotBodyId } from "../../shared/bot-body";
import { BotAvatar, MausAvatar } from "./Avatar";
import { AvatarImageGenerator } from "./AvatarImageGenerator";
import { AvatarFraming, OrganizationAvatarIcons, RESET_MASCOT_PATCH, useAvatarImage, type AvatarPatch } from "./avatar-editing";
import { t } from "@/lib/i18n";
import { MascotFaceColorPicker } from "./MascotFaceColorPicker";

export function BotProfileAvatarCard({
  bot,
  activeState,
  mascotMotion,
  onPatch,
}: {
  bot: Bot;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const { fileRef, crop, uploading, generating, setSavingConnection, busy, error, upload, removeImage, generate } = useAvatarImage(bot, onPatch);
  // A bot already wearing one opens the section, so its own icon is not lost among 151.
  const [pokemonOpen, setPokemonOpen] = useState(() => isPokemonBody(bot.mascotBody));
  const [spritesOpen, setSpritesOpen] = useState(false);
  const [digimonOpen, setDigimonOpen] = useState(false);

  /** A picture travels the way an uploaded image does: stored once, then named by the bot. */
  const usePicture = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(t("botPanel.avatar.spriteFailed"));
      const blob = await response.blob();
      const type = url.endsWith(".gif") ? "image/gif" : "image/png";
      await upload(new File([blob], filename, { type }));
    } catch {
      // upload() reports its own failures; a failed fetch means the picture never arrived.
    }
  };

  /** The animated sprite when there is one, so the icon the bot keeps is the moving one. */
  const useSprite = (number: number) => void usePicture(`/pokemon/animated/${number}.gif`, `pokemon-${number}.gif`);

  return (
    <div className="overflow-hidden rounded-xl border border-hairline/40 bg-card">
      <div className="flex items-center justify-between border-b border-hairline/40 px-3 py-2.5">
        <span className="rounded-lg bg-control px-3 py-1.5 text-[14px] font-medium text-ink">{t("botIdentity.avatar")}</span>
        <button
          disabled={busy}
          onClick={() => onPatch(RESET_MASCOT_PATCH)}
          className="rounded-md px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
        >
          {t("botIdentity.resetMascot")}
        </button>
      </div>

      <div className="p-3">
        <OrganizationAvatarIcons busy={busy} onUpload={(file) => void upload(file)} />
        {crop !== "mascot" && bot.avatarUrl ? (
          <AvatarFraming bot={bot} disabled={busy} onPatch={onPatch} />
        ) : (
          <div className="flex justify-center py-3">
            <BotAvatar
              bot={bot}
              state={activeState}
              size={112}
              motion={mascotMotion?.kind ?? "none"}
              motionKey={mascotMotion?.nonce ?? 0}
            />
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="sr-only"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {t("botIdentity.uploadImage")}
          </button>
          {bot.avatarUrl && (
            <button
              type="button"
              onClick={removeImage}
              disabled={busy}
              aria-label={t("botIdentity.removeAvatar")}
              title={t("botIdentity.removeImage")}
              className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="mt-1.5 text-[12px] text-ink-secondary">{t("botIdentity.imageTypes")}</div>

        <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
          {t("botIdentity.shape")}
        </div>
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-hairline/40">
          {BOT_AVATAR_CROPS.map((candidate, index) => (
            <button
              key={candidate}
              type="button"
              disabled={busy}
              aria-pressed={crop === candidate}
              onClick={() => onPatch({ avatarCrop: candidate })}
              className={cn(
                "py-1.5 text-[13px] disabled:opacity-50",
                index > 0 && "border-l border-hairline/40",
                crop === candidate ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/60 hover:text-ink",
              )}
            >
              {t(`botIdentity.crop.${candidate}` as never)}
            </button>
          ))}
        </div>

        {crop === "mascot" && (
          <>
            <MascotFaceColorPicker bot={bot} disabled={busy} onPatch={onPatch} />
            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("botIdentity.expression")}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {PICKABLE_STATES.map((expression) => (
                <button
                  key={expression}
                  type="button"
                  disabled={busy}
                  aria-pressed={activeState === expression}
                  onClick={() => onPatch({ mascotExpression: expression })}
                  className={cn(
                    "flex h-[58px] items-center justify-center rounded-xl bg-inset transition-colors hover:bg-control disabled:opacity-50",
                    activeState === expression && "ring-2 ring-accent-border",
                  )}
                  title={expression}
                  aria-label={`Use ${expression} expression`}
                >
                  <MausAvatar color={bot.color} faceColor={bot.mascotFaceColor} bodyId={bot.mascotBody ?? undefined} state={expression} size={42} animated={false} />
                </button>
              ))}
            </div>

            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("botIdentity.color")}
            </div>
            <div className="flex flex-wrap gap-2.5">
              {MAUS_COLOR_NAMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={busy}
                  aria-pressed={bot.color === color}
                  onClick={() => onPatch({ color })}
                  className={cn(
                    "size-10 rounded-full border-2 border-transparent transition-transform hover:scale-110 disabled:opacity-50",
                    bot.color === color && "ring-2 ring-accent-border ring-offset-2 ring-offset-card",
                  )}
                  style={{ background: colorSwatch(color) }}
                  title={t(MAUS_COLOR_LABEL[color])}
                  aria-label={`Use ${color} mascot color`}
                />
              ))}
            </div>

            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("botIdentity.body")}
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {MASCOT_BODY_IDS.map((id) => (
                <BodyButton key={id} id={id} name={MASCOT_BODIES[id].name} bot={bot} busy={busy} onPatch={onPatch} />
              ))}
            </div>
            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("botPanel.avatar.halloween")}
            </div>
            <div className="grid grid-cols-5 gap-1.5" data-halloween-bodies>
              {HALLOWEEN_BODY_IDS.map((id) => (
                <BodyButton key={id} id={id} name={HALLOWEEN_BODIES[id].name} bot={bot} busy={busy} onPatch={onPatch} />
              ))}
            </div>
            {/* 151 icons at once would bury the two rows above, so they get a section of their own. */}
            <button
              type="button"
              data-avatar-pokemon
              aria-expanded={pokemonOpen}
              onClick={() => setPokemonOpen((open) => !open)}
              className="mt-4 flex w-full items-center justify-between rounded-lg bg-inset px-3 py-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary hover:bg-control hover:text-ink"
            >
              {t("botPanel.avatar.pokemon")}
              <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", pokemonOpen && "rotate-180")} />
            </button>
            {pokemonOpen && (
              <div data-avatar-pokemon-bodies className="mt-2 max-h-[260px] overflow-y-auto">
                <div className="grid grid-cols-5 gap-1.5">
                  {POKEMON_BODY_IDS.map((id) => (
                    <BodyButton key={id} id={id} name={POKEMON_BODIES[id].name} bot={bot} busy={busy} onPatch={onPatch} />
                  ))}
                </div>
              </div>
            )}

            {/* The original game sprites: a picture of the creature, not a shape wearing the mascot's face. */}
            <button
              type="button"
              data-avatar-sprites
              aria-expanded={spritesOpen}
              onClick={() => setSpritesOpen((open) => !open)}
              className="mt-2 flex w-full items-center justify-between rounded-lg bg-inset px-3 py-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary hover:bg-control hover:text-ink"
            >
              {t("botPanel.avatar.sprites")}
              <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", spritesOpen && "rotate-180")} />
            </button>
            {spritesOpen && (
              <div data-avatar-sprite-bodies className="mt-2 max-h-[280px] overflow-y-auto">
                <div className="grid grid-cols-5 gap-1.5">
                  {POKEMON_BODY_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      disabled={busy}
                      aria-label={`Use the original ${POKEMON_BODIES[id].name} sprite`}
                      title={POKEMON_BODIES[id].name}
                      onClick={() => void useSprite(POKEMON_BODIES[id].number)}
                      className="flex items-center justify-center rounded-lg py-1.5 hover:bg-control/60 disabled:opacity-50 [image-rendering:pixelated]"
                    >
                      {/* The animated set is the same picture in motion; a slow connection falls back to the still frame. */}
                      <img
                        src={`/pokemon/animated/${POKEMON_BODIES[id].number}.gif`}
                        onError={(event) => {
                          const image = event.currentTarget;
                          if (!image.dataset.still) { image.dataset.still = "1"; image.src = `/pokemon/${POKEMON_BODIES[id].number}.png`; }
                        }}
                        alt=""
                        width={34}
                        height={34}
                        draggable={false}
                        loading="lazy"
                        className="size-[34px] object-contain [image-rendering:pixelated]"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* The Digimon API has portraits rather than game sprites, so they sit in a section of their own. */}
            <button
              type="button"
              data-avatar-digimon
              aria-expanded={digimonOpen}
              onClick={() => setDigimonOpen((open) => !open)}
              className="mt-2 flex w-full items-center justify-between rounded-lg bg-inset px-3 py-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary hover:bg-control hover:text-ink"
            >
              {t("botPanel.avatar.digimon")}
              <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", digimonOpen && "rotate-180")} />
            </button>
            {digimonOpen && (
              <div data-avatar-digimon-bodies className="mt-2 max-h-[280px] overflow-y-auto">
                <div className="grid grid-cols-5 gap-1.5">
                  {DIGIMON_SPRITES.map((digimon) => (
                    <button
                      key={digimon.slug}
                      type="button"
                      disabled={busy}
                      aria-label={`Use the ${digimon.name} Digimon`}
                      title={digimon.name}
                      onClick={() => void usePicture(`/digimon/${digimon.slug}.png`, `digimon-${digimon.slug}.png`)}
                      className="flex items-center justify-center rounded-lg py-1.5 hover:bg-control/60 disabled:opacity-50"
                    >
                      <img src={`/digimon/${digimon.slug}.png`} alt="" width={34} height={34} draggable={false} loading="lazy" className="size-[34px] object-contain" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <AvatarImageGenerator
          botLabel={bot.title || bot.name}
          disabled={uploading}
          generating={generating}
          onGenerate={generate}
          onSavingChange={setSavingConnection}
        />

        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}

function BodyButton({ id, name, bot, busy, onPatch }: {
  id: BotBodyId;
  name: string;
  bot: Bot;
  busy: boolean;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const selected = (bot.mascotBody ?? "cursor") === id;
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={selected}
      aria-label={`Use the ${name} body`}
      onClick={() => onPatch({ mascotBody: id })}
      className={cn(
        "flex items-center justify-center rounded-lg py-1.5 disabled:opacity-50",
        selected ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/60",
      )}
    >
      <MausAvatar color={bot.color} faceColor={bot.mascotFaceColor} bodyId={id} size={34} animated={false} trackPointer={false} />
    </button>
  );
}
