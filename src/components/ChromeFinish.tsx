import type { ReactNode } from "react";

import type { MascotBody } from "../../shared/mascot-bodies";

/** Polished chrome-plated steel, top to bottom over the body: cool mid-grey steel, a bright horizon band about 35–45%
 * down with a darker band just under it, the bottom lifting again, and a thin bright rim along the top edge. */
export interface MetalFinish {
  stops: ReadonlyArray<readonly [offset: number, color: string]>;
  rim: string;
  shade: string;
  eyes: string;
}

export const CHROME_STEEL: MetalFinish = {
  stops: [[0, "#E4EAF1"], [0.3, "#A8B4C2"], [0.39, "#F4F7FA"], [0.44, "#E2E8EE"], [0.5, "#717E8E"], [0.72, "#8794A4"], [1, "#BAC4CF"]],
  rim: "#FFFFFF",
  shade: "#1E2833",
  eyes: "#1E2833",
};

/** A body's scale inside the face box: its rim is drawn at one width on screen whatever the body. */
const bodyScale = (fit: string): number => Number(/scale\(([\d.]+)/.exec(fit)?.[1]) || 1;

/** The finish over a mascot's body (CursorAvatar's `overBody`), clipped to it, under the face. */
export function metalLayers(uid: string, silhouette: Pick<MascotBody, "fit" | "clip">, finish: MetalFinish = CHROME_STEEL): ReactNode {
  const rimWidth = 9 / bodyScale(silhouette.fit);
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2="0" y2="1">
          {finish.stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
        </linearGradient>
        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={finish.rim} stopOpacity="0.95" />
          <stop offset="0.22" stopColor={finish.rim} stopOpacity="0" />
          <stop offset="0.82" stopColor={finish.shade} stopOpacity="0" />
          <stop offset="1" stopColor={finish.shade} stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <g transform={silhouette.fit || undefined} fill={`url(#${uid}-metal)`} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
      <g clipPath={`url(#${uid}-clip)`}>
        <g transform={silhouette.fit || undefined} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth={rimWidth} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
      </g>
    </>
  );
}
