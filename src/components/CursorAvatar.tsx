/**
 * CursorAvatar — an animated mascot built on the "cursor" silhouette.
 *
 * Self-contained: React is the only dependency. Drop this file in and use it.
 *
 *   import CursorAvatar from './CursorAvatar'
 *
 *   <CursorAvatar state="thinking" size={160} />
 *
 * The state drives everything — which expressions cycle, how often, and when it blinks.
 * Set `state` and it animates itself; see CURSOR_STATES for the full list.
 *
 * Props of note:
 *   state        one of CURSOR_STATES
 *   expression   pin a single face and stop the cycling
 *   lookAround   how much each expression glances around. 0 = always straight ahead
 *   gaze / turn  aim the eyes, or rotate the head around its implied sphere
 *   showMouth    false for an eyes-only face
 *
 * Made with Blob Studio.
 */
import React, { useEffect, useId, useMemo, useRef } from 'react'

import {
  EXPRESSIONS,
  EXPRESSION_COUNT,
  FACE_BOX,
  FACE_CENTRE,
  GAZE,
  GAZE_TRAVEL,
  MOUTHS,
  MOUTH_STROKE,
  mouthFrame,
  type Ring,
} from "./cursor-face-data"

export {
  EXPRESSIONS,
  EXPRESSION_COUNT,
  FACE_BOX,
  FACE_CENTRE,
  GAZE,
  GAZE_TRAVEL,
  MOUTHS,
  MOUTH_STROKE,
  mouthFrame,
}
export type { Ring }

/* ------------------------------------------------------------------- shape */

export interface CursorSilhouette {
  /** Human-readable name, used for the accessible label. */
  name: string
  /** Transform mapping the artwork into the 228.541-unit face box. '' for none. */
  fit: string
  /** SVG markup for the body. The token {{GRADIENT}} is replaced with the instance gradient. */
  body: string
  /** SVG markup defining the clip region — the union of the silhouette's filled shapes. */
  clip: string
  /** Where the face sits inside the silhouette, in face-space units. */
  anchor: { x: number; y: number; scale: number }
  /**
   * When set, the body is this image clipped to the silhouette rather than a
   * gradient fill. A typed prop, not a token in `body` — `body` and `clip` are
   * injected as raw markup, and interpolating a URL into raw markup is an
   * injection path.
   */
  bodyImage?: string
}

export const DEFAULT_SILHOUETTE: CursorSilhouette = {
  name: "cursor",
  fit: "translate(-56.5564 -37.6751) scale(0.593899)",
  body: "\n<path xmlns=\"http://www.w3.org/2000/svg\" d=\"M0 0 C1.12815992 0.94880479 2.25705591 1.89673511 3.38671875 2.84375 C5.57657936 4.68528228 7.75793952 6.53624249 9.93359375 8.39453125 C13.5602214 11.48647103 17.25022962 14.49819427 20.9453125 17.5078125 C25.41301487 21.15281776 29.86103386 24.8215994 34.31054688 28.48876953 C38.00933931 31.5370903 41.70951059 34.58367973 45.4140625 37.625 C52.50037463 43.44570076 59.55669812 49.29508834 66.54003906 55.23901367 C70.43289872 58.54377434 74.40406577 61.73568847 78.40625 64.90625 C82.05401433 67.85083084 85.6145398 70.89451533 89.18359375 73.93359375 C92.41424312 76.67774533 95.67698054 79.36747809 99 82 C103.47931906 85.54855146 107.83340036 89.22936876 112.18359375 92.93359375 C115.41424312 95.67774533 118.67698054 98.36747809 122 101 C125.9014198 104.09073517 129.71091352 107.27378506 133.5 110.5 C137.99002543 114.32092614 142.53350963 118.0537239 147.15234375 121.71875 C156.74255328 129.40144186 166.1812645 137.27326897 175.53833008 145.23754883 C179.4317456 148.54281661 183.40347641 151.73522157 187.40625 154.90625 C191.05401433 157.85083084 194.6145398 160.89451533 198.18359375 163.93359375 C201.41424312 166.67774533 204.67698054 169.36747809 208 172 C236.43637507 194.63776677 236.43637507 194.63776677 238.27050781 209.13867188 C239.19944445 221.27193361 237.57124038 231.13444436 230 241 C223.66050278 247.82715086 215.75482398 254.47140646 206.04764748 255.13307858 C205.3615811 255.13693349 204.67551472 255.1407884 203.96865845 255.14476013 C203.17563324 255.15165863 202.38260803 255.15855713 201.56555176 255.16566467 C200.27360901 255.16958473 200.27360901 255.16958473 198.95556641 255.17358398 C198.04112762 255.180271 197.12668884 255.18695801 196.18453979 255.19384766 C194.19843498 255.20789156 192.21231409 255.21978771 190.22618484 255.22979546 C187.07149762 255.24625057 183.91692738 255.26949556 180.76229858 255.29469299 C171.79227585 255.36530712 162.82220292 255.42526708 153.85205078 255.47680664 C148.36195434 255.5088283 142.87198905 255.55017011 137.38199997 255.59700203 C135.30028042 255.61289593 133.21853066 255.62527474 131.13676834 255.63390923 C104.46972494 255.74602279 80.75351522 259.19455182 60.52978516 278.41845703 C55.75259196 283.35727885 51.81217213 289.04473423 47.77441406 294.5859375 C44.62107661 298.87600364 41.36381878 303.08685058 38.125 307.3125 C32.82026548 314.26649347 27.55386673 321.24815866 22.3125 328.25 C21.07690581 329.89589556 19.84122979 331.5417297 18.60546875 333.1875 C16.22002164 336.36552908 13.84996009 339.55428087 11.48828125 342.75 C3.0450311 354.10095576 -5.25712203 365.22607871 -20 368 C-33.42903027 368.85957067 -44.2929604 367.90032788 -55 358.9140625 C-63.51513963 350.76480778 -67.79688328 340.99527428 -68.37686157 329.29350281 C-68.43541887 328.1487851 -68.49397617 327.00406738 -68.55430794 325.82466125 C-68.61453573 324.57243271 -68.67476353 323.32020416 -68.73681641 322.0300293 C-68.80423726 320.68369989 -68.87198477 319.33738681 -68.94003105 317.99108887 C-69.12569162 314.29881586 -69.30666938 310.60632592 -69.48688698 306.91378379 C-69.68142908 302.94481208 -69.88036562 298.97606035 -70.07873535 295.00727844 C-70.55465828 285.46711948 -71.02377004 275.92663022 -71.49235249 266.3861084 C-71.71278092 261.90166682 -71.93398876 257.41726373 -72.1552124 252.93286133 C-72.22122149 251.59460763 -72.22122149 251.59460763 -72.28856409 250.2293185 C-72.37783973 248.41936974 -72.46711776 246.6094211 -72.55639815 244.79947257 C-72.7821203 240.22326204 -73.00777832 235.64704836 -73.23336792 231.0708313 C-73.2783997 230.15734865 -73.32343148 229.24386601 -73.36982787 228.30270207 C-73.64581049 222.70253299 -73.92113412 217.10233189 -74.19602597 211.50210917 C-75.35713101 187.85146938 -76.54638525 164.20245932 -77.76320994 140.55462319 C-78.3174362 129.77404232 -78.86176258 118.9929594 -79.40472984 108.2118063 C-79.83986282 99.58021501 -80.28322749 90.94912395 -80.73695588 82.31848997 C-81.04621068 76.42094211 -81.34513355 70.52292566 -81.63612723 64.62444884 C-81.8031421 61.24551841 -81.97612174 57.86718776 -82.15861511 54.48903847 C-84.29931862 14.73242483 -84.29931862 14.73242483 -72.03125 -1.625 C-50.89854752 -24.96559677 -21.34867451 -18.24899383 0 0 Z \" fill=\"#000000\" transform=\"translate(210,80)\"/>\n",
  clip: "<path xmlns=\"http://www.w3.org/2000/svg\" d=\"M0 0 C1.12815992 0.94880479 2.25705591 1.89673511 3.38671875 2.84375 C5.57657936 4.68528228 7.75793952 6.53624249 9.93359375 8.39453125 C13.5602214 11.48647103 17.25022962 14.49819427 20.9453125 17.5078125 C25.41301487 21.15281776 29.86103386 24.8215994 34.31054688 28.48876953 C38.00933931 31.5370903 41.70951059 34.58367973 45.4140625 37.625 C52.50037463 43.44570076 59.55669812 49.29508834 66.54003906 55.23901367 C70.43289872 58.54377434 74.40406577 61.73568847 78.40625 64.90625 C82.05401433 67.85083084 85.6145398 70.89451533 89.18359375 73.93359375 C92.41424312 76.67774533 95.67698054 79.36747809 99 82 C103.47931906 85.54855146 107.83340036 89.22936876 112.18359375 92.93359375 C115.41424312 95.67774533 118.67698054 98.36747809 122 101 C125.9014198 104.09073517 129.71091352 107.27378506 133.5 110.5 C137.99002543 114.32092614 142.53350963 118.0537239 147.15234375 121.71875 C156.74255328 129.40144186 166.1812645 137.27326897 175.53833008 145.23754883 C179.4317456 148.54281661 183.40347641 151.73522157 187.40625 154.90625 C191.05401433 157.85083084 194.6145398 160.89451533 198.18359375 163.93359375 C201.41424312 166.67774533 204.67698054 169.36747809 208 172 C236.43637507 194.63776677 236.43637507 194.63776677 238.27050781 209.13867188 C239.19944445 221.27193361 237.57124038 231.13444436 230 241 C223.66050278 247.82715086 215.75482398 254.47140646 206.04764748 255.13307858 C205.3615811 255.13693349 204.67551472 255.1407884 203.96865845 255.14476013 C203.17563324 255.15165863 202.38260803 255.15855713 201.56555176 255.16566467 C200.27360901 255.16958473 200.27360901 255.16958473 198.95556641 255.17358398 C198.04112762 255.180271 197.12668884 255.18695801 196.18453979 255.19384766 C194.19843498 255.20789156 192.21231409 255.21978771 190.22618484 255.22979546 C187.07149762 255.24625057 183.91692738 255.26949556 180.76229858 255.29469299 C171.79227585 255.36530712 162.82220292 255.42526708 153.85205078 255.47680664 C148.36195434 255.5088283 142.87198905 255.55017011 137.38199997 255.59700203 C135.30028042 255.61289593 133.21853066 255.62527474 131.13676834 255.63390923 C104.46972494 255.74602279 80.75351522 259.19455182 60.52978516 278.41845703 C55.75259196 283.35727885 51.81217213 289.04473423 47.77441406 294.5859375 C44.62107661 298.87600364 41.36381878 303.08685058 38.125 307.3125 C32.82026548 314.26649347 27.55386673 321.24815866 22.3125 328.25 C21.07690581 329.89589556 19.84122979 331.5417297 18.60546875 333.1875 C16.22002164 336.36552908 13.84996009 339.55428087 11.48828125 342.75 C3.0450311 354.10095576 -5.25712203 365.22607871 -20 368 C-33.42903027 368.85957067 -44.2929604 367.90032788 -55 358.9140625 C-63.51513963 350.76480778 -67.79688328 340.99527428 -68.37686157 329.29350281 C-68.43541887 328.1487851 -68.49397617 327.00406738 -68.55430794 325.82466125 C-68.61453573 324.57243271 -68.67476353 323.32020416 -68.73681641 322.0300293 C-68.80423726 320.68369989 -68.87198477 319.33738681 -68.94003105 317.99108887 C-69.12569162 314.29881586 -69.30666938 310.60632592 -69.48688698 306.91378379 C-69.68142908 302.94481208 -69.88036562 298.97606035 -70.07873535 295.00727844 C-70.55465828 285.46711948 -71.02377004 275.92663022 -71.49235249 266.3861084 C-71.71278092 261.90166682 -71.93398876 257.41726373 -72.1552124 252.93286133 C-72.22122149 251.59460763 -72.22122149 251.59460763 -72.28856409 250.2293185 C-72.37783973 248.41936974 -72.46711776 246.6094211 -72.55639815 244.79947257 C-72.7821203 240.22326204 -73.00777832 235.64704836 -73.23336792 231.0708313 C-73.2783997 230.15734865 -73.32343148 229.24386601 -73.36982787 228.30270207 C-73.64581049 222.70253299 -73.92113412 217.10233189 -74.19602597 211.50210917 C-75.35713101 187.85146938 -76.54638525 164.20245932 -77.76320994 140.55462319 C-78.3174362 129.77404232 -78.86176258 118.9929594 -79.40472984 108.2118063 C-79.83986282 99.58021501 -80.28322749 90.94912395 -80.73695588 82.31848997 C-81.04621068 76.42094211 -81.34513355 70.52292566 -81.63612723 64.62444884 C-81.8031421 61.24551841 -81.97612174 57.86718776 -82.15861511 54.48903847 C-84.29931862 14.73242483 -84.29931862 14.73242483 -72.03125 -1.625 C-50.89854752 -24.96559677 -21.34867451 -18.24899383 0 0 Z \" transform=\"translate(210,80)\"/>",
  anchor: { x: 93, y: 101, scale: 0.74 },
}

export const DEFAULT_GRADIENT: [string, string, string] = ["#9FE6B5","#3FAE6E","#1C7A4C"]

const VIEW_BOX = `-15 -15 ${FACE_BOX + 30} ${FACE_BOX + 30}`
const SPHERE_C = 114.2705
const SPHERE_R = 105

/* ------------------------------------------------------------------ motion */

/**
 * How the body itself moves. The face engine on its own leaves the silhouette perfectly
 * still, which reads as dead for states literally named `bouncing` or `spawning`.
 *
 * All of this is shape-agnostic — it moves whatever silhouette it is given, so an uploaded
 * logo animates exactly like the built-in circle.
 *
 *   bob     vertical travel, [amplitude in face units, period ms]
 *   sway    rotation, [degrees, period ms]
 *   pulse   uniform scale, [fraction, period ms] — breathing
 *   circle  orbital drift, [radius, period ms]
 *   jitter  fast nervous shake, [amplitude, period ms]
 *   tilt    constant lean, degrees
 *   squash  0..1, how much a bob squashes the body at the bottom of its arc
 *   enter   one-shot on entering the state, [starting scale, duration ms]
 *   settle  scale it eases to and holds, for exits like powering-down
 */
export interface BodyMotion {
  bob?: [number, number]
  sway?: [number, number]
  pulse?: [number, number]
  circle?: [number, number]
  jitter?: [number, number]
  tilt?: number
  squash?: number
  enter?: [number, number]
  settle?: number
}

export const MOTION = {
  // Lifecycle — quiet, breathing, alive but not busy.
  sleeping: { pulse: [0.028, 4600], tilt: 2 },
  waking: { enter: [0.92, 700], pulse: [0.03, 2200] },
  idle: { pulse: [0.014, 3600] },
  listening: { bob: [2, 2600], pulse: [0.012, 2600] },
  thinking: { sway: [1.6, 3000], pulse: [0.01, 3000] },
  searching: { bob: [3, 1400], sway: [2.2, 1400] },
  working: { bob: [2.5, 900], squash: 0.22 },

  // Reactions — the loud half.
  excited: { bob: [9, 520], sway: [3, 1040], squash: 0.35 },
  surprised: { enter: [1.14, 340], jitter: [0.8, 120] },
  suspicious: { sway: [2.4, 2600], tilt: -3 },
  angry: { jitter: [1.3, 95], tilt: 2 },
  drowsy: { pulse: [0.026, 5000], tilt: 3 },
  happy: { bob: [5, 820], squash: 0.28 },
  curious: { sway: [3.4, 1900], tilt: -4 },
  confused: { sway: [3, 2200] },
  bored: { pulse: [0.016, 5200], tilt: 2 },
  proud: { bob: [1.6, 2400], pulse: [0.02, 2400] },
  shy: { pulse: [0.016, 3000], tilt: 4 },
  sad: { pulse: [0.02, 4600], tilt: 3 },
  laughing: { bob: [7, 430], squash: 0.4 },
  scared: { jitter: [2.2, 75] },
  playful: { bob: [6, 620], sway: [5, 1240], squash: 0.3 },
  celebrate: { bob: [10, 480], sway: [4, 960], squash: 0.35 },

  // Agent morphs — the mascot standing in for a process.
  orbit: { circle: [6, 3200] },
  radar: { sway: [6, 2400], pulse: [0.012, 2400] },
  progress: { pulse: [0.022, 1600] },

  // Product cycle.
  spawning: { enter: [0.02, 820], pulse: [0.014, 3600] },
  humming: { pulse: [0.016, 2800] },
  loading: { sway: [2.2, 1500], pulse: [0.012, 1500] },
  dictating: { bob: [2, 2000] },
  writing: { bob: [1.6, 1100] },
  sending: { bob: [3, 900] },
  receiving: { bob: [3, 900] },
  uploading: { bob: [3, 1000] },
  notifying: { bob: [4, 700], sway: [2.5, 700] },
  alerting: { jitter: [2.6, 85] },
  dragging: { tilt: -6, sway: [2, 900] },
  bouncing: { bob: [12, 560], squash: 0.45 },
  'powering-down': { settle: 0.05, tilt: 4 },
} satisfies Record<CursorState, BodyMotion>

/** How long a `settle` takes to reach its resting scale. */
const SETTLE_MS = 1400

/* ----------------------------------------------------------------- effects */

/**
 * Confetti, motion ribbons, and glyph morphs.
 *
 * All three are shape-agnostic: they orbit, burst around, or stand in for whatever
 * silhouette they are given, so an uploaded logo behaves exactly like the built-in circle.
 *
 * These layers are driven imperatively from the frame loop rather than through React
 * state. A celebrate burst is ~14 elements changing every frame, and a page showing all
 * states at once would otherwise re-render continuously.
 */

const TAU = Math.PI * 2

/** Deterministic per-particle randomness — same seed, same particle, every run. */
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const CONFETTI_COLORS = ['#F472B6', '#C084FC', '#818CF8', '#38BDF8', '#34D399', '#FACC15', '#FB7185']
const RIBBON_COLORS = ['#4ADE80', '#34D399', '#22D3EE', '#60A5FA']

export interface ConfettiSpec {
  /** How many pieces are in flight per burst. */
  count: number
  /** Milliseconds between bursts. */
  period: number
  /** How long one piece lives, ms. */
  life: number
  /** Radius the pieces launch from, so a burst clears the face instead of covering it. */
  origin: number
  /** How far pieces travel beyond that, in face units. */
  spread: number
}

export interface TrailSpec {
  /** How many ribbons orbit the body. */
  count: number
  /** Milliseconds for one full orbit. */
  period: number
  /** Orbit radius, in face units. */
  radius: number
}

export interface GlyphSpec {
  /** Markup drawn in place of the body. {{GRADIENT}} is replaced with the body paint. */
  markup: string
  /** Milliseconds between appearances. */
  period: number
  /** How long the glyph is held, ms. */
  hold: number
}

export interface StateEffects {
  confetti?: ConfettiSpec
  trails?: TrailSpec
  glyph?: GlyphSpec
}

interface EffectsByState extends Partial<Record<CursorState, StateEffects>> {}

/**
 * The exclamation mark the mascot becomes when something needs attention — drawn as a
 * tapered bar and a dot so it reads as a character rather than a rectangle.
 */
const GLYPH_BANG =
  '<path fill="{{GRADIENT}}" d="M99 58 Q99 43 114.3 43 Q129.6 43 129.6 58 L123 150 Q122 161 114.3 161 Q106.6 161 105.6 150 Z"/>' +
  '<circle fill="{{GRADIENT}}" cx="114.3" cy="188" r="15"/>'

/** The question mark for genuine confusion. Stroked, so it stays light against the body. */
const GLYPH_QUERY =
  '<path fill="none" stroke="{{GRADIENT}}" stroke-width="19" stroke-linecap="round" ' +
  'd="M88 76 A27 27 0 1 1 114.3 112 L114.3 132"/>' +
  '<circle fill="{{GRADIENT}}" cx="114.3" cy="170" r="13"/>'

export const EFFECTS: EffectsByState = {
  // Celebration — the loud burst.
  // Travel is deliberately bounded: the viewBox only carries 15 units of margin, so a
  // piece thrown much past ~130 from centre would be clipped mid-flight.
  celebrate: { confetti: { count: 16, period: 1500, life: 1300, origin: 74, spread: 54 } },
  excited: { confetti: { count: 9, period: 2000, life: 1100, origin: 72, spread: 44 } },
  laughing: { confetti: { count: 7, period: 2400, life: 1000, origin: 70, spread: 38 } },

  // Work in flight — ribbons circling the body.
  orbit: { trails: { count: 3, period: 2600, radius: 128 } },
  radar: { trails: { count: 2, period: 2000, radius: 132 } },
  progress: { trails: { count: 3, period: 1800, radius: 124 } },
  loading: { trails: { count: 2, period: 2200, radius: 126 } },
  uploading: { trails: { count: 2, period: 1700, radius: 122 } },
  sending: { trails: { count: 2, period: 1500, radius: 120 } },
  receiving: { trails: { count: 2, period: 1500, radius: 120 } },

  // The mascot standing aside to show a symbol.
  alerting: { glyph: { markup: GLYPH_BANG, period: 2600, hold: 1100 } },
  notifying: { glyph: { markup: GLYPH_BANG, period: 4200, hold: 900 } },
  confused: { glyph: { markup: GLYPH_QUERY, period: 5200, hold: 1200 } },
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Grows or shrinks a layer's pool of <path> children to exactly `count`. */
function poolPaths(layer: SVGGElement, count: number): SVGPathElement[] {
  while (layer.childNodes.length > count) layer.removeChild(layer.lastChild!)
  while (layer.childNodes.length < count) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('fill', 'none')
    layer.appendChild(path)
  }
  return Array.from(layer.querySelectorAll<SVGPathElement>(':scope > path'))
}

/** Confetti: short curved strokes thrown outward, arcing down as they fade. */
function drawConfetti(
  layer: SVGGElement,
  spec: ConfettiSpec,
  elapsed: number,
  strength: number,
  cx: number,
  cy: number
) {
  const paths = poolPaths(layer, spec.count)
  for (let i = 0; i < spec.count; i++) {
    const path = paths[i]
    const seedA = hash01(i + 1)
    const seedB = hash01(i + 41)
    const seedC = hash01(i + 91)

    // Stagger the pieces across the burst window so they don't leave as one wall.
    const t = (((elapsed + seedC * spec.period) % spec.period) / spec.life) * 1
    if (t > 1) {
      path.setAttribute('opacity', '0')
      continue
    }

    const angle = seedA * TAU
    const travel = spec.spread * (0.45 + seedB * 0.55) * (1 - (1 - t) * (1 - t))
    const distance = (spec.origin + travel) * strength
    const gravity = 34 * strength * t * t
    const x = cx + Math.cos(angle) * distance
    const y = cy + Math.sin(angle) * distance + gravity
    const length = 11 + seedB * 12
    const spin = angle + (seedC - 0.5) * 5 * t
    const ex = x + Math.cos(spin) * length
    const ey = y + Math.sin(spin) * length
    // A slight bend reads as paper rather than a matchstick.
    const bend = (seedA - 0.5) * length * 0.7
    const mx = (x + ex) / 2 - Math.sin(spin) * bend
    const my = (y + ey) / 2 + Math.cos(spin) * bend

    path.setAttribute('d', `M${x.toFixed(1)} ${y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`)
    path.setAttribute('stroke', CONFETTI_COLORS[i % CONFETTI_COLORS.length])
    path.setAttribute('stroke-width', (4 + seedB * 2.4).toFixed(1))
    path.setAttribute('opacity', (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88).toFixed(3))
  }
}

/** Ribbons: arcs sweeping around the body on their own periods. */
function drawTrails(
  layer: SVGGElement,
  spec: TrailSpec,
  elapsed: number,
  strength: number,
  cx: number,
  cy: number
) {
  const paths = poolPaths(layer, spec.count)
  const SAMPLES = 12
  for (let i = 0; i < spec.count; i++) {
    const path = paths[i]
    const seedA = hash01(i + 3)
    const seedB = hash01(i + 29)
    const direction = i % 2 === 0 ? 1 : -1
    const period = spec.period * (0.8 + seedA * 0.5)
    const radius = spec.radius * strength * (0.78 + seedB * 0.4)
    const start = direction * (elapsed / period) * TAU + seedA * TAU
    const span = 0.85 + seedB * 0.7

    let d = ''
    for (let s = 0; s <= SAMPLES; s++) {
      const k = s / SAMPLES
      const angle = start + span * k
      // Breathe the radius along the arc so the ribbon curls instead of tracing a circle.
      const r = radius * (1 + Math.sin(k * Math.PI) * 0.14)
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r * 0.78
      d += (s === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)
    }
    path.setAttribute('d', d)
    path.setAttribute('stroke', RIBBON_COLORS[i % RIBBON_COLORS.length])
    path.setAttribute('stroke-width', (5 + seedA * 3).toFixed(1))
    path.setAttribute('opacity', '0.85')
  }
}

/** How present the glyph is right now, 0..1, with eased edges. */
function glyphAmount(spec: GlyphSpec, elapsed: number): number {
  const position = elapsed % spec.period
  const start = spec.period - spec.hold
  if (position < start) return 0
  const into = position - start
  const remaining = spec.hold - into
  const EASE = 200
  return Math.max(0, Math.min(1, Math.min(into, remaining) / EASE))
}

export interface EffectFrame {
  trails: SVGGElement | null
  confetti: SVGGElement | null
  glyph: SVGGElement | null
  bodyContent: SVGGElement | null
  state: CursorState
  elapsed: number
  strength: number
  paint: string
  showEffects: boolean
  showGlyphs: boolean
}

/** Called once per frame from the engine loop. */
export function updateEffects(frame: EffectFrame) {
  const spec = EFFECTS[frame.state]
  const centre = FACE_BOX / 2
  const strength = frame.strength

  if (frame.trails) {
    if (spec?.trails && frame.showEffects && strength > 0) {
      drawTrails(frame.trails, spec.trails, frame.elapsed, strength, centre, centre)
    } else if (frame.trails.childNodes.length) {
      frame.trails.replaceChildren()
    }
  }

  if (frame.confetti) {
    if (spec?.confetti && frame.showEffects && strength > 0) {
      drawConfetti(frame.confetti, spec.confetti, frame.elapsed, strength, centre, centre)
    } else if (frame.confetti.childNodes.length) {
      frame.confetti.replaceChildren()
    }
  }

  if (frame.glyph && frame.bodyContent) {
    if (spec?.glyph && frame.showGlyphs) {
      const amount = glyphAmount(spec.glyph, frame.elapsed)
      const markup = spec.glyph.markup.replace(/\{\{GRADIENT\}\}/g, frame.paint)
      if (frame.glyph.getAttribute('data-glyph') !== markup) {
        frame.glyph.setAttribute('data-glyph', markup)
        frame.glyph.innerHTML = markup
      }
      frame.glyph.style.opacity = String(amount)
      // Scale up as it arrives, so the swap reads as a transformation.
      const scale = 0.72 + 0.28 * amount
      frame.glyph.setAttribute(
        'transform',
        `translate(${centre} ${centre}) scale(${scale.toFixed(3)}) translate(${-centre} ${-centre})`
      )
      // The body steps aside rather than sitting behind the glyph.
      frame.bodyContent.style.opacity = String(1 - amount)
    } else {
      if (frame.glyph.getAttribute('data-glyph')) {
        frame.glyph.removeAttribute('data-glyph')
        frame.glyph.replaceChildren()
      }
      frame.glyph.style.opacity = '0'
      frame.bodyContent.style.opacity = '1'
    }
  }
}

/* ------------------------------------------------------------------ states */

export type CursorState =
  | "sleeping"
  | "waking"
  | "idle"
  | "listening"
  | "thinking"
  | "searching"
  | "working"
  | "excited"
  | "surprised"
  | "suspicious"
  | "angry"
  | "drowsy"
  | "happy"
  | "curious"
  | "confused"
  | "bored"
  | "proud"
  | "shy"
  | "sad"
  | "laughing"
  | "scared"
  | "playful"
  | "celebrate"
  | "orbit"
  | "radar"
  | "progress"
  | "spawning"
  | "humming"
  | "loading"
  | "dictating"
  | "sending"
  | "receiving"
  | "uploading"
  | "writing"
  | "notifying"
  | "alerting"
  | "bouncing"
  | "dragging"
  | "powering-down"

/**
 * Which expressions a state cycles through. The first is its resting face, chosen as the
 * pool's most forward-facing member so a mascot at rest looks at you rather than past you.
 */
export const POOLS = {
  sleeping: [
    22,
    13,
    4
  ],
  waking: [
    13
  ],
  idle: [
    6,
    0,
    8
  ],
  listening: [
    1,
    10,
    19
  ],
  thinking: [
    17,
    8,
    16,
    14,
    5
  ],
  searching: [
    20,
    15,
    9,
    3,
    12,
    18
  ],
  working: [
    10,
    7,
    16,
    11
  ],
  excited: [
    2,
    17,
    21,
    3,
    11
  ],
  surprised: [
    21,
    3
  ],
  suspicious: [
    5,
    14,
    23
  ],
  angry: [
    7,
    16
  ],
  drowsy: [
    22,
    4,
    13
  ],
  happy: [
    19,
    2,
    11,
    17
  ],
  curious: [
    21,
    3,
    0,
    15
  ],
  confused: [
    8,
    14,
    5
  ],
  bored: [
    0,
    4,
    22
  ],
  proud: [
    2,
    15,
    8
  ],
  shy: [
    24,
    0,
    13
  ],
  sad: [
    22,
    4,
    13
  ],
  laughing: [
    2,
    11,
    17
  ],
  scared: [
    21,
    3
  ],
  playful: [
    2,
    17,
    11,
    8
  ],
  celebrate: [
    2,
    8,
    17
  ],
  orbit: [
    6,
    0,
    8
  ],
  radar: [
    6,
    0,
    8
  ],
  progress: [
    6,
    0,
    8
  ],
  spawning: [
    3,
    0
  ],
  humming: [
    6,
    0,
    8
  ],
  loading: [
    6,
    0,
    8
  ],
  dictating: [
    1,
    10,
    19
  ],
  sending: [
    6,
    0,
    8
  ],
  receiving: [
    19,
    0,
    8
  ],
  uploading: [
    15,
    9,
    8
  ],
  writing: [
    15,
    9
  ],
  notifying: [
    21,
    3,
    0
  ],
  alerting: [
    21,
    3
  ],
  bouncing: [
    2,
    17
  ],
  dragging: [
    3,
    15,
    0
  ],
  "powering-down": [
    22,
    13
  ]
} satisfies Record<CursorState, number[]>

/** How long a state holds an expression before drifting to another, in ms. */
const EXPR_CADENCE = {
  sleeping: [
    6000,
    10000
  ],
  waking: [
    800,
    800
  ],
  idle: [
    9000,
    16000
  ],
  listening: [
    2800,
    5000
  ],
  thinking: [
    2000,
    3600
  ],
  searching: [
    1000,
    1800
  ],
  working: [
    1800,
    3200
  ],
  excited: [
    1100,
    2000
  ],
  surprised: [
    2500,
    4000
  ],
  suspicious: [
    2600,
    4500
  ],
  angry: [
    2200,
    3800
  ],
  drowsy: [
    4000,
    8000
  ],
  happy: [
    2500,
    4500
  ],
  curious: [
    1800,
    3200
  ],
  confused: [
    2200,
    3800
  ],
  bored: [
    3500,
    6000
  ],
  proud: [
    3500,
    6000
  ],
  shy: [
    3000,
    5500
  ],
  sad: [
    4000,
    7000
  ],
  laughing: [
    1200,
    2400
  ],
  scared: [
    900,
    1800
  ],
  playful: [
    1500,
    3000
  ],
  celebrate: [
    1400,
    2600
  ],
  orbit: [
    4000,
    8000
  ],
  radar: [
    4000,
    8000
  ],
  progress: [
    4000,
    8000
  ],
  spawning: [
    1200,
    1200
  ],
  humming: [
    5000,
    9000
  ],
  loading: [
    6000,
    10000
  ],
  dictating: [
    4000,
    8000
  ],
  sending: [
    4000,
    8000
  ],
  receiving: [
    4000,
    8000
  ],
  uploading: [
    4000,
    8000
  ],
  writing: [
    4000,
    8000
  ],
  notifying: [
    1500,
    2600
  ],
  alerting: [
    2000,
    3600
  ],
  bouncing: [
    3000,
    6000
  ],
  dragging: [
    1600,
    3000
  ],
  "powering-down": [
    6000,
    9000
  ]
} satisfies Record<CursorState, [number, number]>

/** Blink cadence in ms, or null for states that never blink. */
const BLINK = {
  sleeping: null,
  waking: null,
  idle: [
    6000,
    14000
  ],
  listening: [
    3000,
    7000
  ],
  thinking: [
    3500,
    7000
  ],
  searching: [
    1600,
    4000
  ],
  working: [
    2800,
    5500
  ],
  excited: [
    2000,
    4000
  ],
  surprised: [
    1800,
    3500
  ],
  suspicious: [
    4500,
    8000
  ],
  angry: [
    3500,
    7000
  ],
  drowsy: null,
  happy: [
    2500,
    5000
  ],
  curious: [
    2500,
    5500
  ],
  confused: [
    2800,
    5500
  ],
  bored: [
    4000,
    8000
  ],
  proud: [
    3500,
    7000
  ],
  shy: [
    3000,
    6000
  ],
  sad: [
    4000,
    8000
  ],
  laughing: [
    2500,
    5000
  ],
  scared: [
    1200,
    3000
  ],
  playful: [
    2000,
    4500
  ],
  celebrate: [
    2200,
    4500
  ],
  orbit: null,
  radar: null,
  progress: null,
  spawning: null,
  humming: [
    4000,
    8000
  ],
  loading: null,
  dictating: null,
  sending: null,
  receiving: null,
  uploading: null,
  writing: null,
  notifying: [
    2000,
    4000
  ],
  alerting: null,
  bouncing: null,
  dragging: [
    2200,
    4500
  ],
  "powering-down": null
} satisfies Record<CursorState, [number, number] | null>

/** Grouping, for pickers and docs. */
export const STATE_GROUPS = {
  "Cycle de vie": [
    "sleeping",
    "waking",
    "idle",
    "listening",
    "thinking",
    "searching",
    "working"
  ],
  "Réactions": [
    "excited",
    "surprised",
    "suspicious",
    "angry",
    "drowsy",
    "happy",
    "curious",
    "confused",
    "bored",
    "proud",
    "shy",
    "sad",
    "laughing",
    "scared",
    "playful",
    "celebrate"
  ],
  "Morphes agent": [
    "orbit",
    "radar",
    "progress"
  ],
  "Cycle produit": [
    "spawning",
    "humming",
    "loading",
    "dictating",
    "writing",
    "sending",
    "receiving",
    "uploading",
    "notifying",
    "alerting",
    "dragging",
    "bouncing",
    "powering-down"
  ]
} satisfies Record<string, CursorState[]>

const isCursorState = (state: string): state is CursorState => state in POOLS
export const CURSOR_STATES = Object.keys(POOLS).filter(isCursorState)

/* ------------------------------------------------------------------- maths */

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const noTimestamp = (): number | null => null

const toPath = (ring: Ring) =>
  'M' + ring.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z'

const clone = (rings: Ring[]): Ring[] =>
  rings.map(r => r.map((p): [number, number] => [p[0], p[1]]))

/** Ring centroid — same computation cursor-face-data.ts uses for mouthFrame, needed here too for eye projection. */
const ringCentre = (ring: Ring): [number, number] => {
  let x = 0
  let y = 0
  for (const p of ring) {
    x += p[0]
    y += p[1]
  }
  return [x / ring.length, y / ring.length]
}

export function mouthPath(frame: { x: number; y: number; angle: number }, spec: number[]) {
  const ca = Math.cos(frame.angle)
  const sa = Math.sin(frame.angle)
  const at = (lx: number, ly: number): [number, number] => [
    frame.x + lx * ca - ly * sa,
    frame.y + lx * sa + ly * ca,
  ]
  const a = at(-spec[0], 0)
  const c = at(0, spec[1])
  const b = at(spec[0], 0)
  return (
    'M' + a[0].toFixed(2) + ' ' + a[1].toFixed(2) +
    ' Q' + c[0].toFixed(2) + ' ' + c[1].toFixed(2) +
    ' ' + b[0].toFixed(2) + ' ' + b[1].toFixed(2)
  )
}

/** Face-space transform placing the face inside a silhouette. */
export const anchorTransform = (a: { x: number; y: number; scale: number }) =>
  `translate(${a.x} ${a.y}) scale(${a.scale}) translate(${-FACE_CENTRE[0]} ${-FACE_CENTRE[1]})`

/** Overshooting ease, so a pop-in lands with a little life instead of stopping dead. */
const easeOutBack = (t: number) => {
  const c = 1.7
  const u = t - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t))

/**
 * Builds the body's transform for this frame.
 *
 * `elapsed` is time since the state was entered, which is what one-shot entrances need;
 * loops read it too so every mascot on a page doesn't pulse in lockstep.
 */
export function bodyTransform(motion: BodyMotion, elapsed: number, strength: number): string {
  if (strength <= 0) return ''
  const centre = FACE_BOX / 2
  const ground = FACE_BOX
  const wave = (period: number, phase = 0) => Math.sin((elapsed / period) * Math.PI * 2 + phase)

  let dx = 0
  let dy = 0
  let rotation = motion.tilt ? motion.tilt * strength : 0
  let scale = 1
  let sx = 1
  let sy = 1

  if (motion.bob) {
    const [amplitude, period] = motion.bob
    const p = wave(period)
    dy -= amplitude * strength * p
    if (motion.squash) {
      // Squash at the bottom of the arc, stretch at the top. Volume roughly conserved.
      const amount = motion.squash * strength * Math.max(0, -p)
      sy = 1 - amount * 0.5
      sx = 1 + amount * 0.5
    }
  }
  if (motion.circle) {
    const [radius, period] = motion.circle
    dx += radius * strength * wave(period)
    dy += radius * strength * wave(period, Math.PI / 2)
  }
  if (motion.sway) {
    const [degrees, period] = motion.sway
    rotation += degrees * strength * wave(period)
  }
  if (motion.pulse) {
    const [fraction, period] = motion.pulse
    scale *= 1 + fraction * strength * wave(period)
  }
  if (motion.jitter) {
    const [amplitude, period] = motion.jitter
    // Two incommensurate waves read as nervous rather than metronomic.
    dx += amplitude * strength * wave(period)
    dy += amplitude * strength * wave(period * 0.63, 1.1)
  }
  if (motion.enter) {
    const [from, duration] = motion.enter
    const t = elapsed / duration
    scale *= t >= 1 ? 1 : from + (1 - from) * easeOutBack(Math.max(t, 0))
  }
  if (motion.settle !== undefined) {
    const t = Math.min(Math.max(elapsed / SETTLE_MS, 0), 1)
    scale *= 1 + (motion.settle - 1) * easeInOut(t) * strength
  }

  const parts: string[] = []
  if (dx || dy) parts.push(`translate(${dx.toFixed(2)} ${dy.toFixed(2)})`)
  if (rotation) parts.push(`rotate(${rotation.toFixed(2)} ${centre} ${centre})`)
  if (scale !== 1) {
    parts.push(`translate(${centre} ${centre}) scale(${scale.toFixed(4)}) translate(${-centre} ${-centre})`)
  }
  if (sx !== 1 || sy !== 1) {
    // Squash pivots on the ground, not the middle — otherwise it floats instead of landing.
    parts.push(`translate(${centre} ${ground}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${-centre} ${-ground})`)
  }
  return parts.join(' ')
}

/* --------------------------------------------------------------- component */

export interface CursorAvatarProps {
  state?: CursorState
  /** Pin a specific expression. Stops the state's own cycling. */
  expression?: number
  size?: number | string
  /** Eye offset, each axis -1…1. */
  gaze?: { x?: number; y?: number }
  /** Head turn in degrees; the eyes wrap around the implied sphere. */
  turn?: number
  /** How much of each expression's own look-direction to apply. 0 = always forward. */
  lookAround?: number
  flip?: boolean
  spring?: number
  eyeScale?: number
  showMouth?: boolean
  mouthStroke?: number
  /** How strongly the body itself moves. 0 holds it perfectly still, 1 is full motion. */
  motion?: number
  /** Confetti and motion ribbons. */
  effects?: boolean
  /** Let states like alerting replace the mascot with a symbol. */
  glyphs?: boolean
  autoBlink?: boolean
  autoExpression?: boolean
  paused?: boolean
  /** Silhouette to wear. Defaults to the baked-in mascot silhouette. */
  silhouette?: CursorSilhouette
  gradient?: [string, string, string]
  eyeColor?: string
  title?: string | null
  className?: string
  style?: React.CSSProperties
}

export interface CursorAvatarHandle {
  blink: () => void
  spin: (durationMs?: number) => void
  setExpression: (index: number) => void
}

export const CursorAvatar = React.forwardRef<CursorAvatarHandle, CursorAvatarProps>(
  function CursorAvatar(
    {
      state = 'idle',
      expression,
      size = 160,
      gaze,
      turn = 0,
      lookAround = 0.5,
      flip = false,
      spring = 7,
      eyeScale = 1,
      showMouth = true,
      mouthStroke = MOUTH_STROKE,
      motion,
      effects = true,
      glyphs = true,
      autoBlink = true,
      autoExpression = true,
      paused = false,
      silhouette = DEFAULT_SILHOUETTE,
      gradient = DEFAULT_GRADIENT,
      eyeColor = "#ffffff",
      title,
      className,
      style,
    },
    ref
  ) {
    const reactId = useId()
    const uid = useMemo(() => 'mascot' + reactId.replace(/[^a-zA-Z0-9]/g, ''), [reactId])
    const eye0 = useRef<SVGPathElement | null>(null)
    const eye1 = useRef<SVGPathElement | null>(null)
    const mouth = useRef<SVGPathElement | null>(null)
    const bodyGroup = useRef<SVGGElement | null>(null)
    const bodyContent = useRef<SVGGElement | null>(null)
    const trailLayer = useRef<SVGGElement | null>(null)
    const confettiLayer = useRef<SVGGElement | null>(null)
    const glyphLayer = useRef<SVGGElement | null>(null)

    // Respect the OS setting unless the caller states a preference explicitly.
    const prefersReducedMotion = useMemo(
      () => globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
      []
    )
    const motionStrength = motion ?? (prefersReducedMotion ? 0 : 1)
    const lastState: CursorState = state

    // Frame-loop state lives in a ref so prop changes never restart a morph.
    const engine = useRef({
      current: clone(EXPRESSIONS[0]),
      target: EXPRESSIONS[0],
      currentMouth: MOUTHS[0].slice(),
      targetMouth: MOUTHS[0],
      currentGaze: [...GAZE[0]],
      targetGaze: [...GAZE[0]],
      expression: 0,
      morph: 1,
      velocity: 0,
      blinkStart: noTimestamp(),
      spinStart: noTimestamp(),
      spinDuration: 900,
      last: 0,
      stateStart: 0,
      lastState,
      lastBodyTransform: '',
      // what the parked loop last painted; '' means "never" so a mascot that
      // mounts paused still gets its one resting-face paint
      pausedPaint: '',
      props: {
        state,
        expression,
        gaze,
        turn,
        spring,
        eyeScale,
        paused,
        lookAround,
        motionStrength,
        effects,
        glyphs,
      },
    })
    engine.current.props = {
      state,
      expression,
      gaze,
      turn,
      spring,
      eyeScale,
      paused,
      lookAround,
      motionStrength,
      effects,
      glyphs,
    }

    const selectExpression = (index: number) => {
      const e = engine.current
      const i = ((index % EXPRESSION_COUNT) + EXPRESSION_COUNT) % EXPRESSION_COUNT
      if (i === e.expression && e.morph >= 1) return
      e.current = displayed(e)
      e.currentMouth = displayedMouth(e)
      e.currentGaze = displayedGaze(e)
      e.target = EXPRESSIONS[i]
      e.targetMouth = MOUTHS[i]
      e.targetGaze = GAZE[i]
      e.expression = i
      e.morph = 0
      e.velocity = 0
    }

    React.useImperativeHandle(
      ref,
      () => ({
        blink: () => {
          engine.current.blinkStart = performance.now()
        },
        spin: (durationMs = 900) => {
          engine.current.spinDuration = durationMs
          engine.current.spinStart = performance.now()
        },
        setExpression: selectExpression,
      }),
      []
    )

    useEffect(() => {
      selectExpression(expression ?? POOLS[state][0])
    }, [state, expression])

    useEffect(() => {
      if (!autoExpression || expression !== undefined || paused) return
      let timer: ReturnType<typeof setTimeout>
      const tick = () => {
        const [lo, hi] = EXPR_CADENCE[state]
        timer = setTimeout(() => {
          const pool = POOLS[state]
          const alternatives = pool.filter(x => x !== engine.current.expression)
          selectExpression(
            alternatives.length
              ? alternatives[Math.floor(Math.random() * alternatives.length)]
              : pool[0]
          )
          tick()
        }, lo + Math.random() * (hi - lo))
      }
      tick()
      return () => clearTimeout(timer)
    }, [state, autoExpression, expression, paused])

    useEffect(() => {
      const cadence = BLINK[state]
      if (!autoBlink || !cadence || paused) return
      let timer: ReturnType<typeof setTimeout>
      const tick = () => {
        timer = setTimeout(() => {
          engine.current.blinkStart = performance.now()
          tick()
        }, cadence[0] + Math.random() * (cadence[1] - cadence[0]))
      }
      tick()
      return () => clearTimeout(timer)
    }, [state, autoBlink, paused])

    useEffect(() => {
      let frame = 0
      let wake: ReturnType<typeof setTimeout> | undefined
      engine.current.last = performance.now()

      const draw = (e: typeof engine.current, now: number, spinTurn: number) => {
        const p = e.props
        // Re-apply a fraction of this expression's own look-direction.
        const g = displayedGaze(e)
        const look = p.lookAround ?? 0.35
        const ox = g[0] * look
        const oy = g[1] * look
        const rings = displayed(e).map(ring =>
          ring.map((pt): [number, number] => [pt[0] + ox, pt[1] + oy])
        )
        const gx = clamp(p.gaze?.x ?? 0, -1, 1) * GAZE_TRAVEL.x
        const gy = clamp(p.gaze?.y ?? 0, -1, 1) * GAZE_TRAVEL.y
        const radians = (((p.turn ?? 0) + spinTurn) * Math.PI) / 180
        const base = p.eyeScale ?? 1
        const blink = blinkScale(e, now)

        rings.forEach((ring, index) => {
          const el = index === 0 ? eye0.current : eye1.current
          if (!el) return
          const c = ringCentre(ring)
          const baseLongitude = Math.asin(clamp((c[0] - SPHERE_C) / SPHERE_R, -1, 1))
          const longitude = baseLongitude + radians
          const depth = Math.cos(longitude)
          const perspective = Math.max(depth, 0.02) / Math.max(Math.cos(baseLongitude), 0.02)
          el.setAttribute('d', toPath(ring))
          el.setAttribute(
            'transform',
            `translate(${(SPHERE_C + SPHERE_R * Math.sin(longitude) + gx).toFixed(2)} ${(
              c[1] + gy
            ).toFixed(2)}) scale(${clamp(perspective * base, 0.02, 2.4).toFixed(4)} ${clamp(
              blink * base,
              0.02,
              2.4
            ).toFixed(4)}) translate(${(-c[0]).toFixed(2)} ${(-c[1]).toFixed(2)})`
          )
          el.style.opacity = depth > 0.02 ? '1' : '0'
        })

        // Mouth: same sphere projection as the eyes, but blinking never touches it.
        const mouthEl = mouth.current
        if (mouthEl) {
          const spec = displayedMouth(e)
          const frameGeom = mouthFrame(rings, spec)
          const baseLongitude = Math.asin(clamp((frameGeom.x - SPHERE_C) / SPHERE_R, -1, 1))
          const longitude = baseLongitude + radians
          const depth = Math.cos(longitude)
          const perspective = Math.max(depth, 0.02) / Math.max(Math.cos(baseLongitude), 0.02)
          mouthEl.setAttribute('d', mouthPath(frameGeom, spec))
          mouthEl.setAttribute(
            'transform',
            `translate(${(SPHERE_C + SPHERE_R * Math.sin(longitude) + gx).toFixed(2)} ${(
              frameGeom.y + gy
            ).toFixed(2)}) scale(${clamp(perspective, 0.02, 2.4).toFixed(4)} 1) translate(${(
              -frameGeom.x
            ).toFixed(2)} ${(-frameGeom.y).toFixed(2)})`
          )
          mouthEl.style.opacity = depth > 0.02 ? '1' : '0'
        }

        // The body. One-shot entrances need time since the state began, so track that here
        // rather than in an effect — the loop already has the clock.
        const bodyEl = bodyGroup.current
        if (bodyEl) {
          if (p.state !== e.lastState) {
            e.lastState = p.state
            e.stateStart = now
          }
          const transform = bodyTransform(
            MOTION[p.state] ?? {},
            now - e.stateStart,
            p.motionStrength ?? 1
          )
          if (transform !== e.lastBodyTransform) {
            e.lastBodyTransform = transform
            if (transform) bodyEl.setAttribute('transform', transform)
            else bodyEl.removeAttribute('transform')
          }
        }

        updateEffects({
          trails: trailLayer.current,
          confetti: confettiLayer.current,
          glyph: glyphLayer.current,
          bodyContent: bodyContent.current,
          state: p.state,
          elapsed: now - e.stateStart,
          strength: p.motionStrength ?? 1,
          paint: paintRef.current,
          showEffects: p.effects !== false,
          showGlyphs: p.glyphs !== false,
        })
      }

      const step = (now: number) => {
        const e = engine.current
        const p = e.props
        // A paused mascot must not wake at display rate: re-arming BEFORE the
        // pause check once had N idle sidebar faces ticking at 60fps forever.
        // While paused, poll for unpause at 4Hz — but the resting face must
        // still be PAINTED: the SVG layers hold no expression until the first
        // draw, so a mascot that mounts paused would otherwise stay blank.
        // One draw per change of what the still face shows, then park.
        if (p.paused) {
          e.last = now
          const still = `${p.state}|${p.expression ?? ''}|${paintRef.current}`
          if (e.pausedPaint !== still) {
            e.pausedPaint = still
            draw(e, now, 0)
          }
          wake = setTimeout(() => {
            frame = requestAnimationFrame(step)
          }, 250)
          return
        }
        e.pausedPaint = ''
        frame = requestAnimationFrame(step)
        const dt = Math.min((now - e.last) / 1000, 0.1)
        e.last = now

        const f = p.spring ?? 7
        e.velocity += (-2 * f * e.velocity - f * f * (e.morph - 1)) * dt
        e.morph += e.velocity * dt
        if (!Number.isFinite(e.morph)) {
          e.morph = 1
          e.velocity = 0
        }

        let spinTurn = 0
        if (e.spinStart !== null) {
          const tt = (now - e.spinStart) / e.spinDuration
          if (tt >= 1) e.spinStart = null
          else spinTurn = 360 * tt
        }

        draw(e, now, spinTurn)
      }

      frame = requestAnimationFrame(step)
      return () => {
        cancelAnimationFrame(frame)
        if (wake !== undefined) clearTimeout(wake)
      }
    }, [])

    const paint = `url(#${uid}-grad)`
    const paintRef = useRef(paint)
    paintRef.current = paint

    const dimension = size.constructor === Number ? `${size}px` : size
    const label = title === undefined ? `${silhouette.name} mascot` : title
    const body = silhouette.body.replace(/\{\{GRADIENT\}\}/g, `url(#${uid}-grad)`)

    return (
      <svg
        viewBox={VIEW_BOX}
        width={dimension}
        height={dimension}
        className={className}
        style={style}
        role={label ? 'img' : undefined}
        aria-label={label ?? undefined}
        aria-hidden={label ? undefined : true}
      >
        <defs>
          <linearGradient id={`${uid}-grad`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradient[0]} />
            <stop offset="55%" stopColor={gradient[1]} />
            <stop offset="100%" stopColor={gradient[2]} />
          </linearGradient>
          {/* The fit goes on the clipPath itself: a <g> inside one is ignored by browsers,
              which is also why silhouette.clip is pre-flattened to bare shapes. */}
          <clipPath
            id={`${uid}-clip`}
            transform={silhouette.fit || undefined}
            dangerouslySetInnerHTML={{ __html: silhouette.clip }}
          />
          {/* Face is drawn in white; over a pale image it disappears without this scrim.
              Centred on the silhouette's own anchor, not the face box's centre — shapes
              like `shield` put the face far from the box centre. */}
          {silhouette.bodyImage && (
            <radialGradient
              id={`${uid}-scrim`}
              gradientUnits="userSpaceOnUse"
              cx={silhouette.anchor.x}
              cy={silhouette.anchor.y}
              r={FACE_BOX * 0.55}
            >
              <stop offset="0%" stopColor="#000000" stopOpacity="0.42" />
              <stop offset="65%" stopColor="#000000" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          )}
        </defs>
        <g transform={flip ? `translate(${FACE_BOX} 0) scale(-1 1)` : undefined}>
          {/* Ribbons sit behind the mascot, confetti in front of it. */}
          <g ref={trailLayer} />
          {/* Body and face move together — the face is painted on the body, not floating
              in front of it, so a squash or a tilt has to carry both. The glyph rides the
              same motion but is not faded with them, since it replaces them. */}
          <g ref={bodyGroup}>
          <g ref={bodyContent}>
          {silhouette.bodyImage ? (
            <>
              <image
                href={silhouette.bodyImage}
                x={0}
                y={0}
                width={FACE_BOX}
                height={FACE_BOX}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${uid}-clip)`}
              />
              <rect
                x={0}
                y={0}
                width={FACE_BOX}
                height={FACE_BOX}
                fill={`url(#${uid}-scrim)`}
                clipPath={`url(#${uid}-clip)`}
              />
            </>
          ) : (
            <g transform={silhouette.fit || undefined} dangerouslySetInnerHTML={{ __html: body }} />
          )}
          <g clipPath={`url(#${uid}-clip)`}>
            <g transform={anchorTransform(silhouette.anchor)}>
              <path ref={eye0} fill={eyeColor} />
              <path ref={eye1} fill={eyeColor} />
              {showMouth && (
                <path
                  ref={mouth}
                  fill="none"
                  stroke={eyeColor}
                  strokeWidth={mouthStroke}
                  strokeLinecap="round"
                />
              )}
            </g>
          </g>
          </g>
          <g ref={glyphLayer} style={{ opacity: 0 }} />
          </g>
          <g ref={confettiLayer} />
        </g>
      </svg>
    )
  }
)

/* ----------------------------------------------------------------- helpers */

function displayed(e: { current: Ring[]; target: Ring[]; morph: number }): Ring[] {
  const m = clamp(e.morph, 0, 1)
  return e.current.map((ring, eye) =>
    ring.map((p, i): [number, number] => [
      p[0] + (e.target[eye][i][0] - p[0]) * m,
      p[1] + (e.target[eye][i][1] - p[1]) * m,
    ])
  )
}

function displayedMouth(e: { currentMouth: number[]; targetMouth: number[]; morph: number }) {
  const m = clamp(e.morph, 0, 1)
  return e.currentMouth.map((v, i) => v + (e.targetMouth[i] - v) * m)
}

function displayedGaze(e: { currentGaze: number[]; targetGaze: number[]; morph: number }) {
  const m = clamp(e.morph, 0, 1)
  return e.currentGaze.map((v, i) => v + (e.targetGaze[i] - v) * m)
}

function blinkScale(e: { blinkStart: number | null }, now: number) {
  if (e.blinkStart === null) return 1
  const t = (now - e.blinkStart) / 320
  if (t >= 1) {
    e.blinkStart = null
    return 1
  }
  // Fast close, slower open.
  return Math.max(t < 0.42 ? 1 - t / 0.42 : (t - 0.42) / 0.58, 0.04)
}

export default CursorAvatar
