import type { ReactNode } from "react";

import type { MascotBody } from "../../shared/mascot-bodies";
import { VIEW_SPAN } from "./mascot-motion";

/** Brushed steel over a mascot's body: a steel tone that is lightest where the light falls and darker toward the edges,
 * fine grain lines across it, a soft broad sheen, and a thin bright rim along the top edge. */
export interface MetalFinish {
  /** Lightest, middle and edge tones of the steel. */
  tones: readonly [string, string, string];
  /** Where the light falls, as a fraction of the body. */
  light: { x: number; y: number };
  /** Grain lines: noise frequency across and along the lines, and how strong they show on a large avatar. */
  grain: { across: number; along: number; strength: number };
  sheen: number;
  rim: string;
  shade: string;
  eyes: string;
}

export const BRUSHED_STEEL: MetalFinish = {
  tones: ["#F1F4F7", "#AEB8C3", "#66717E"],
  light: { x: 0.34, y: 0.26 },
  grain: { across: 0.004, along: 0.42, strength: 0.32 },
  sheen: 0.32,
  rim: "#FFFFFF",
  shade: "#1E2833",
  eyes: "#1E2833",
};

export const CHROME_STEEL = BRUSHED_STEEL;

/** Grain shows on a large avatar and fades out by sidebar size, where it would only be noise. */
export const grainAt = (finish: MetalFinish, size: number): number => finish.grain.strength * Math.max(0, Math.min(1, (size - 36) / 60));

/** A body's scale inside the face box: its rim is drawn at one width on screen whatever the body. */
const bodyScale = (fit: string): number => Number(/scale\(([\d.]+)/.exec(fit)?.[1]) || 1;

/** The finish over a mascot's body (CursorAvatar's `overBody`), clipped to it, under the face. With a rendered `image`
 * of the body, that image is the finish, over the drawn steel without its grain in case it does not load. */
export function metalLayers(uid: string, silhouette: Pick<MascotBody, "fit" | "clip">, finish: MetalFinish, size: number, image?: string | null): ReactNode {
  const rimWidth = 9 / bodyScale(silhouette.fit);
  const grain = image ? 0 : grainAt(finish, size);
  const [light, mid, edge] = finish.tones;
  return (
    <>
      <defs>
        <radialGradient id={`${uid}-steel`} cx={finish.light.x} cy={finish.light.y} r="0.95" fx={finish.light.x} fy={finish.light.y}>
          <stop offset="0" stopColor={light} />
          <stop offset="0.5" stopColor={mid} />
          <stop offset="1" stopColor={edge} />
        </radialGradient>
        <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.15" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.42" stopColor="#FFFFFF" stopOpacity={finish.sheen} />
          <stop offset="0.7" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={finish.rim} stopOpacity="0.9" />
          <stop offset="0.22" stopColor={finish.rim} stopOpacity="0" />
          <stop offset="0.8" stopColor={finish.shade} stopOpacity="0" />
          <stop offset="1" stopColor={finish.shade} stopOpacity="0.4" />
        </linearGradient>
        {grain > 0 && (
          <filter id={`${uid}-grain`} x="-15" y="-15" width={VIEW_SPAN} height={VIEW_SPAN} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={`${finish.grain.across} ${finish.grain.along}`} numOctaves="2" seed="7" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        )}
      </defs>
      <g transform={silhouette.fit || undefined} fill={`url(#${uid}-steel)`} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
      <g clipPath={`url(#${uid}-clip)`}>
        {grain > 0 && <rect x="-15" y="-15" width={VIEW_SPAN} height={VIEW_SPAN} filter={`url(#${uid}-grain)`} opacity={grain} style={{ mixBlendMode: "overlay" }} />}
        <g transform={silhouette.fit || undefined} fill={`url(#${uid}-sheen)`} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
        <g transform={silhouette.fit || undefined} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth={rimWidth} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
      </g>
      {image && <image href={image} x="-15" y="-15" width={VIEW_SPAN} height={VIEW_SPAN} preserveAspectRatio="none" data-steel-body="" />}
    </>
  );
}
