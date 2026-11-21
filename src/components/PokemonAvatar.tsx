import { forwardRef, memo } from "react";
import { POKEMON_BODIES, type PokemonBodyId } from "../../shared/pokemon-bodies";
import type { CursorAvatarHandle } from "./CursorAvatar";
import { CarvedAvatar, type CarvedShape } from "./CarvedAvatar";
import { MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import type { MascotFaceColor } from "../../shared/bot-avatar";

/** The parts a Pokémon body paints, with its own colour and marking filled in. */
function shapeFor(bodyId: PokemonBodyId, color: MausColor): CarvedShape {
  const body = POKEMON_BODIES[bodyId];
  const botColor = MAUS_COLORS[color] ?? MAUS_COLORS.green;
  const paint = body.paint === "bot" ? botColor : body.color;
  const accent = body.accent ?? "#ffffff";
  return {
    id: body.id,
    clip: body.clip,
    eyes: body.eyes,
    parts: body.parts.map((part) => ({
      fill: part.fill === "body" ? paint : part.fill === "accent" ? accent : part.fill,
      d: part.d,
    })),
  };
}

export type PokemonAvatarProps = {
  body: PokemonBodyId;
  color: MausColor;
  faceColor?: MascotFaceColor | null;
  size?: number;
  state?: MausState;
  motion?: MausMotion;
  motionKey?: number;
  gaze?: { x?: number; y?: number };
  trackPointer?: boolean;
  animated?: boolean;
  label?: string;
};

function PokemonAvatarComponent(
  { body: bodyId, color, faceColor, size, state, motion, motionKey, gaze, trackPointer, animated, label }: PokemonAvatarProps,
  ref: React.Ref<CursorAvatarHandle>,
) {
  return (
    <CarvedAvatar
      ref={ref}
      body={shapeFor(bodyId, color)}
      color={color}
      faceColor={faceColor}
      size={size}
      state={state}
      motion={motion}
      motionKey={motionKey}
      gaze={gaze}
      trackPointer={trackPointer}
      animated={animated}
      label={label}
    />
  );
}

export const PokemonAvatar = memo(forwardRef(PokemonAvatarComponent));
