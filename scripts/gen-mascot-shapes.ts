/**
 * Bakes the mascot shape catalog into `shared/mascot-shapes.ts`.
 *
 * Run with `pnpm gen:shapes`. Everything downstream of this script — the picker, the
 * renderer, the persisted bot profile — reads the emitted module and never re-derives
 * geometry at runtime, because solving a face placement costs tens of millions of
 * distance samples and the answer never changes between runs.
 *
 * The pipeline, per shape:
 *
 *   flatten            outline path data -> polylines
 *   boundsOf           the drawn extent, NOT the advisory `viewBox`
 *   fitTransform       that extent -> the mascot's face box
 *   applyFit           polylines in face space
 *   maskFromPolylines  a filled binary mask
 *   fieldFromMask      a signed distance field
 *   maxScaleAt         where the face goes and how big it can be
 *
 * Two things make the result honest rather than merely plausible:
 *
 * 1. Four aims. The avatar renders faces `forward`, which cancels each expression's
 *    authored gaze and hands the pointer its full travel — so the eyes can be pulled to
 *    any corner. Each shape is solved against all four extreme aims at once and keeps the
 *    WORST of them. A single centred solve yields a face that clips the moment the mouse
 *    moves. Solving the aims separately and keeping the smallest answer is not enough
 *    either: each aim's best anchor is somewhere else, and a face has exactly one anchor.
 *    So the four aims' point clouds are pooled into a single constraint set, and the
 *    solver looks for one placement that satisfies all of them together.
 *
 * 2. One shared size. The smallest scale in the catalog is applied to every shape, and
 *    each shape's anchor is then re-solved at that fixed size. Roomier bodies get more
 *    margin rather than a bigger face, which is what makes the ten read as one character
 *    wearing different bodies instead of ten unrelated mascots.
 *
 * The run fails, loudly and with a non-zero exit, if any expression would clip at any
 * shape's final anchor at any aim. That assertion is the feature's correctness guarantee:
 * if it fires, an outline or the face data is wrong. Fix the geometry, never the check.
 *
 * The output is deterministic — no clock, no environment, no unordered iteration — so a
 * fresh run reproduces the checked-in file byte for byte.
 *
 * Plain TypeScript only: this is loaded by `node --experimental-strip-types`, so nothing
 * beyond type annotations the stripper can erase.
 */

import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { MOUTH_STROKE } from "../src/components/cursor-face-data.ts"
import { SHAPE_DEFS, type ShapeDef } from "./mascot-shapes/builders.ts"
import { applyFit, boundsOf, fitTransform, flatten } from "./mascot-shapes/geometry.ts"
import { maskFromPolylines } from "./mascot-shapes/raster.ts"
import { fieldFromMask, largestInscribedCircle, type Sdf } from "./mascot-shapes/sdf.ts"
import { buildClouds, maxScaleAt, report } from "./mascot-shapes/solve.ts"

/** The id the catalog falls back to, and the shape whose face size sets the floor. */
const DEFAULT_ID = "cursor"

/**
 * `Avatar.tsx` renders every expression facing forward, which zeroes the authored gaze
 * offsets. The pointer supplies all of the eye travel instead, via `aim`.
 */
const LOOK_AROUND = 0

/** The four corners of the pointer's travel. The face must survive all of them. */
const AIMS = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
] as const

/** Mask resolution. 256 puts a pixel at ~0.9 face-space units. */
const RASTER_SIZE = 256

interface Anchor {
  x: number
  y: number
  scale: number
}

/**
 * `fitTransform`'s full result — the SVG transform string the web renderer parses, plus
 * its numeric components. iOS has no SVG transform parser: it builds a `CGAffineTransform`
 * straight from `scale`/`tx`/`ty`, which is the whole reason `fitTransform` returns both.
 */
type Fit = ReturnType<typeof fitTransform>

interface Solved {
  def: ShapeDef
  fit: Fit
  sdf: Sdf
  /** The largest face this body can hold at one anchor that survives all four aims. */
  scale: number
  /** That anchor, used to seed the re-solve once the catalog's shared scale is known. */
  seed: Anchor
}

/* ------------------------------------------------------------------- solving */

/** The four aims' point clouds, built once and reused across every anchor candidate. */
const CLOUD_SETS = AIMS.map(aim => buildClouds(LOOK_AROUND, MOUTH_STROKE, aim))

/**
 * Every expression at every aim, pooled into one constraint set.
 *
 * It is tempting to solve each aim on its own and keep the smallest of the four answers.
 * That is wrong, and quietly so. Each aim's best anchor sits somewhere different, so the
 * per-aim minimum is only an UPPER BOUND on what a real placement can deliver — it promises
 * a face size that no single anchor achieves. A face has exactly one anchor and cannot move
 * it when the pointer moves, so the four aims are constraints on the same placement and
 * have to be satisfied together. Pooling them is what makes the solved size honest; solved
 * separately, the shipped cursor reads as 0.892 against artwork that has always been 0.74.
 */
const ALL_CLOUDS = CLOUD_SETS.flat()

/** The scale cap. 1.0 reproduces the proportions the expressions were drawn at. */
const CAP = 1

/** Runs one shape through the whole geometry pipeline and solves it against all four aims. */
function solveShape(def: ShapeDef): Solved {
  // `def.viewBox` is advisory and deliberately wrong for two shapes; bounds always come
  // from the flattened outline.
  const polylines = flatten(def.d)
  const fit = fitTransform(boundsOf(polylines))
  const mask = maskFromPolylines(applyFit(polylines, fit), RASTER_SIZE)
  const sdf = fieldFromMask(mask, RASTER_SIZE)

  // Seed at the largest inscribed circle, then sweep outward: a slightly worse-centred
  // anchor often holds a bigger face, because the widest part of a body is rarely where
  // its roundest part is.
  //
  // Coarse to fine, and deliberately WITHOUT the `if (!improved) break` that solveFit uses.
  // That early exit is only sound when the step shrinks monotonically, so a ring that finds
  // nothing means the neighbourhood is exhausted. Ported to a growing step it silently
  // truncates the search: a failed ring at step s says nothing whatsoever about a ring at
  // 2s, which probes an entirely different set of points. The cursor is exactly that case —
  // its first ring improves nothing, so an early break reports the seed's own capacity and
  // never looks further out. Since the tightest shape sets the clamp for the whole catalog,
  // one truncated search shrinks every mascot. Halving the step and running every level is
  // cheap, and the clipping assertion downstream is what makes searching harder safe.
  const circle = largestInscribedCircle(sdf)
  let best: Anchor = {
    x: circle.x,
    y: circle.y,
    scale: maxScaleAt(ALL_CLOUDS, sdf, circle.x, circle.y, CAP),
  }
  let step = Math.max(circle.radius, 12)
  for (let level = 0; level < 8; level++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue
        const x = best.x + dx * step
        const y = best.y + dy * step
        const scale = maxScaleAt(ALL_CLOUDS, sdf, x, y, CAP)
        if (scale > best.scale + 1e-4) best = { x, y, scale }
      }
    }
    step /= 2
  }

  // Rounding for a tidy export can nudge a marginal expression back over the edge, so
  // round first and then walk the scale down until the rounded numbers are honestly clean.
  const seed: Anchor = {
    x: round(best.x, 2),
    y: round(best.y, 2),
    scale: Math.max(Math.floor(best.scale * 1000) / 1000, 0.02),
  }
  for (let i = 0; i < 40 && seed.scale > 0.02 && clearanceAt(sdf, seed) < 0; i++) {
    seed.scale = round(seed.scale - 0.005, 3)
  }

  return { def, fit, sdf, scale: seed.scale, seed }
}

/** Worst clearance across every expression at every aim. Negative means something clips. */
function clearanceAt(sdf: Sdf, anchor: Anchor): number {
  let worst = Infinity
  for (const clouds of CLOUD_SETS) {
    const c = report(clouds, sdf, anchor).clearance
    if (c < worst) worst = c
  }
  return worst
}

/** Which expressions clip, per aim, at a placement. Empty arrays mean the placement is clean. */
function clippingAt(sdf: Sdf, anchor: Anchor): number[][] {
  return CLOUD_SETS.map(clouds => report(clouds, sdf, anchor).clipping)
}

const round = (n: number, places: number) => Number(n.toFixed(places))

/**
 * Re-solves a shape's anchor with the scale held at the catalog's shared size.
 *
 * A coarse-to-fine sweep: evaluate a grid around the current best, keep the best
 * clearance, halve the step, repeat. Candidates are rounded to the precision they will be
 * emitted at before they are scored, so the winning anchor is one that was actually
 * measured — rounding afterwards could quietly nudge a marginal expression over the edge.
 */
function anchorAt(sdf: Sdf, seed: Anchor, scale: number): Anchor {
  const circle = largestInscribedCircle(sdf)
  const candidates: Anchor[] = [
    { x: round(seed.x, 2), y: round(seed.y, 2), scale },
    { x: round(circle.x, 2), y: round(circle.y, 2), scale },
  ]
  let best = candidates[0]
  let bestClearance = clearanceAt(sdf, best)
  for (const candidate of candidates.slice(1)) {
    const clearance = clearanceAt(sdf, candidate)
    if (clearance > bestClearance) {
      best = candidate
      bestClearance = clearance
    }
  }

  let step = Math.max(circle.radius, 12)
  for (let level = 0; level < 7; level++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue
        const candidate = {
          x: round(best.x + dx * step, 2),
          y: round(best.y + dy * step, 2),
          scale,
        }
        const clearance = clearanceAt(sdf, candidate)
        if (clearance > bestClearance) {
          best = candidate
          bestClearance = clearance
        }
      }
    }
    step /= 2
  }
  return best
}

/* ------------------------------------------------------------------ emitting */

const quote = (s: string) => JSON.stringify(s)

interface Baked {
  id: string
  name: string
  fit: Fit
  d: string
  anchor: Anchor
  clearance: number
}

function emit(shapes: Baked[]): string {
  const ids = shapes.map(s => quote(s.id)).join(", ")
  const entries = shapes
    .map(shape =>
      [
        `  ${shape.id}: {`,
        `    id: ${quote(shape.id)},`,
        `    name: ${quote(shape.name)},`,
        `    fit: ${quote(shape.fit.transform)},`,
        `    body: ${quote(`<path fill="{{GRADIENT}}" d="${shape.d}"/>`)},`,
        `    clip: ${quote(`<path d="${shape.d}"/>`)},`,
        `    anchor: { x: ${shape.anchor.x}, y: ${shape.anchor.y}, scale: ${shape.anchor.scale} },`,
        `  },`,
      ].join("\n")
    )
    .join("\n")

  return `/**
 * The mascot body shapes a bot can wear.
 *
 * GENERATED FILE — do not hand-edit. Run \`pnpm gen:shapes\` to rebuild it from
 * \`scripts/gen-mascot-shapes.ts\`, which solves each face placement against the real
 * expression geometry and verifies that nothing clips.
 *
 * Every shape carries the same face at the same size: the generator clamps the whole
 * catalog to the smallest face any one body can hold, so the mascot reads as one
 * character in different bodies rather than ten different mascots. Roomier bodies simply
 * end up with more margin around the face.
 *
 * The fields match \`CursorSilhouette\` exactly, so a shape can be handed to the renderer
 * with no adapter in between.
 */

import { z } from "zod";

/** Every selectable shape id, in the order the picker shows them. */
export const MASCOT_SHAPE_IDS = [${ids}] as const;

export type MascotShapeId = (typeof MASCOT_SHAPE_IDS)[number];

export const mascotShapeSchema = z.enum(MASCOT_SHAPE_IDS);

export interface MascotShape {
  id: MascotShapeId;
  /** Human-readable name, used for the picker and the accessible label. */
  name: string;
  /** Transform mapping the outline into the face box. */
  fit: string;
  /** Body markup. \`{{GRADIENT}}\` is replaced with the bot's own gradient. */
  body: string;
  /** The same outline without a fill, used as the clip region. */
  clip: string;
  /** Where the face sits inside the body, in face-space units. */
  anchor: { x: number; y: number; scale: number };
}

/** The shipped mascot, and the fallback for any unrecognised value. */
export const DEFAULT_MASCOT_SHAPE: MascotShapeId = ${quote(DEFAULT_ID)};

export const MASCOT_SHAPES: Record<MascotShapeId, MascotShape> = {
${entries}
};

/** Runtime-safe read of an untrusted persisted or streamed shape id. */
export function botMascotShape(value: unknown): MascotShapeId {
  return mascotShapeSchema.safeParse(value).data ?? DEFAULT_MASCOT_SHAPE;
}
`
}

/* -------------------------------------------------------------- emitting (iOS) */

/**
 * Wraps space-separated path tokens onto lines no wider than `width`, breaking only at
 * whitespace — never inside a token — matching how `MausSilhouette.path` in
 * `ios/App/MausAvatar.swift` is already formatted. That parser treats newlines as plain
 * separators, so wrapping changes nothing about how the path reads.
 */
function wrapPathTokens(d: string, width = 100): string {
  const tokens = d.trim().split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const token of tokens) {
    if (line.length === 0) line = token
    else if (line.length + 1 + token.length <= width) line += " " + token
    else {
      lines.push(line)
      line = token
    }
  }
  if (line.length > 0) lines.push(line)
  return lines.join("\n")
}

/** Prefixes every line of `text` with `spaces` worth of indentation. */
function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces)
  return text
    .split("\n")
    .map(line => pad + line)
    .join("\n")
}

/** Swift string literal, close enough to JSON escaping for the plain ASCII names and ids here. */
const swiftQuote = (s: string) => JSON.stringify(s)

/**
 * Emits the same solved catalog as a Swift source file for `CompanionCore`.
 *
 * CoreGraphics types only (`CGFloat`) and no `import SwiftUI`: `CompanionCore` is
 * deliberately view-free (see the header comment in `ios/Package.swift`), and a later
 * task wraps this data in `SwiftUI.Path` on the app side. The fit is emitted as numbers
 * — `scale`/`tx`/`ty` — rather than the SVG transform string the web takes, because Swift
 * has no SVG transform parser and builds a `CGAffineTransform` straight from the numbers.
 */
function emitSwift(shapes: Baked[]): string {
  const order = shapes.map(s => swiftQuote(s.id)).join(", ")

  const entries = shapes
    .map(shape => {
      const path = indent(wrapPathTokens(shape.d), 16)
      return [
        `        ${swiftQuote(shape.id)}: Shape(`,
        `            id: ${swiftQuote(shape.id)},`,
        `            name: ${swiftQuote(shape.name)},`,
        `            path:`,
        `                """`,
        `${path}`,
        `                """,`,
        `            fit: (scale: ${shape.fit.scale}, tx: ${shape.fit.tx}, ty: ${shape.fit.ty}),`,
        `            anchor: (x: ${shape.anchor.x}, y: ${shape.anchor.y}, scale: ${shape.anchor.scale})`,
        `        ),`,
      ].join("\n")
    })
    .join("\n")

  return `// The mascot body shapes a bot can wear — the phone's half of the same solve that
// bakes \`shared/mascot-shapes.ts\`.
//
// GENERATED FILE — do not hand-edit. Run \`pnpm gen:shapes\` to rebuild it from
// \`scripts/gen-mascot-shapes.ts\`, which solves each face placement against the real
// expression geometry and verifies that nothing clips. One solve, two writers: this file
// and \`shared/mascot-shapes.ts\` come from the same solved anchors, which is what stops
// the two renderers drifting apart the way desktop's 0.74 and iOS's 0.84 already did once.
//
// CoreGraphics only, no SwiftUI — \`CompanionCore\` is everything the phone knows that is
// not a view (see \`ios/Package.swift\`). The fit is numbers, not an SVG transform string:
// iOS has no SVG transform parser, so it builds a \`CGAffineTransform\` from
// \`scale\`/\`tx\`/\`ty\` directly.
//
// Path data is absolute \`M\`, \`C\`, \`Z\` only — the same twenty-line parser convention as
// \`MausSilhouette\` in \`ios/App/MausAvatar.swift\`, which treats newlines as separators.
import CoreGraphics

enum MausShapes {
    struct Shape {
        let id: String
        let name: String
        let path: String
        let fit: (scale: CGFloat, tx: CGFloat, ty: CGFloat)
        let anchor: (x: CGFloat, y: CGFloat, scale: CGFloat)
    }

    /// Every selectable shape id, in the order the picker shows them.
    static let order: [String] = [${order}]

    /// The shipped mascot, and the fallback for any unrecognised value.
    static let defaultID = "cursor"

    static let all: [String: Shape] = [
${entries}
    ]

    /// Looks up a shape by id, falling back to \`defaultID\` for anything unrecognised
    /// (including a nil id, e.g. an untrusted persisted or streamed value).
    static func shape(_ id: String?) -> Shape {
        if let id, let match = all[id] { return match }
        return all[defaultID]!
    }
}
`
}

/* ---------------------------------------------------------------------- main */

function main(): void {
  const solved = SHAPE_DEFS.map(solveShape)

  const cursor = solved.find(s => s.def.id === DEFAULT_ID)
  if (!cursor) throw new Error(`the catalog has no ${DEFAULT_ID} shape to anchor its face size to`)

  const width = Math.max(...solved.map(s => s.def.id.length))
  console.log("largest face each body can hold, worst of the four pointer aims:")
  for (const shape of solved) {
    console.log(`  ${shape.def.id.padEnd(width)}  ${shape.scale.toFixed(3).padStart(6)}`)
  }
  console.log("")

  const shared = solved.reduce((min, s) => Math.min(min, s.scale), Infinity)
  if (shared < cursor.scale) {
    const tighter = solved
      .filter(s => s.scale < cursor.scale)
      .map(s => `${s.def.id} (${s.scale})`)
      .join(", ")
    throw new Error(
      `the shared face scale ${shared} is below ${DEFAULT_ID}'s own ${cursor.scale}: ` +
        `${tighter} cannot hold the shipped face, so clamping the catalog would shrink ` +
        `the mascot everyone already has. Widen those outlines rather than lowering the floor.`
    )
  }

  const baked: Baked[] = []
  const clipped: string[] = []
  for (const shape of solved) {
    const anchor = anchorAt(shape.sdf, shape.seed, shared)
    const clipping = clippingAt(shape.sdf, anchor)
    clipping.forEach((expressions, i) => {
      if (expressions.length === 0) return
      const aim = AIMS[i]
      clipped.push(`${shape.def.id} aim (${aim.x}, ${aim.y}): expressions ${expressions.join(", ")}`)
    })
    baked.push({
      id: shape.def.id,
      name: shape.def.name,
      fit: shape.fit,
      d: shape.def.d,
      anchor,
      clearance: clearanceAt(shape.sdf, anchor),
    })
  }

  console.log(`shared face scale ${shared} (${DEFAULT_ID}'s own floor is ${cursor.scale})`)
  console.log(`${"shape".padEnd(width)}  ${"scale".padStart(6)}  ${"clearance".padStart(9)}`)
  for (const shape of baked) {
    const scale = shape.anchor.scale.toFixed(3).padStart(6)
    const clearance = shape.clearance.toFixed(1).padStart(9)
    console.log(`${shape.id.padEnd(width)}  ${scale}  ${clearance}`)
  }

  if (clipped.length > 0) {
    throw new Error(
      `the face clips at ${clipped.length} placement(s):\n  ${clipped.join("\n  ")}\n` +
        `An outline or the face data is wrong. Fix the geometry — this check is the ` +
        `whole point of the generator and must not be relaxed.`
    )
  }

  const out = fileURLToPath(new URL("../shared/mascot-shapes.ts", import.meta.url))
  writeFileSync(out, emit(baked))
  console.log(`wrote ${out}`)

  // P1 ruling (task 7): emitted into `ios/Sources/CompanionCore`, not `ios/App` — that is
  // the package `swift test` actually builds, so a later test over this catalog can run.
  const swiftOut = fileURLToPath(
    new URL("../ios/Sources/CompanionCore/MausShapes.swift", import.meta.url)
  )
  writeFileSync(swiftOut, emitSwift(baked))
  console.log(`wrote ${swiftOut}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
