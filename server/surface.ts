// Where a bot's hands land — and therefore where the person goes when it
// needs them. A turn can mount two places at once (a computer plus the
// built-in browser), which is exactly what confused people: "do this on the
// web" landed in the cloud box's Chrome one turn and in the Browser tab the
// next, and the "needs your hands" plea never said which. Everything that
// decides or describes a surface lives here, so the picker, the dispatch,
// the system prompt and the notification cannot drift apart.

/** A place a bot can act. `cloud` covers both the Box and VPS backends —
 * from the person's seat they are the same "cloud computer" panel. */
export type Surface = "cloud" | "vm" | "local" | "browser";

/** The bot's "Works on" setting; undefined = Auto. */
export type Destination = Surface | "off" | undefined;

/** What the computer block of a dispatch aims for. Mirrors the old `wants`
 * local exactly, so its strict/auto branches keep their meaning. */
export type ComputerWant = "cloud" | "vm" | "local" | "off" | undefined;

/** What a turn actually mounted, in surface terms. */
export interface MountedSurfaces {
  computer: Surface | null;
  browser: boolean;
}

export interface SurfacePlan {
  computer: ComputerWant;
  browser: boolean;
  /** The surface this Auto turn was held to by the task's pin, or null. */
  pinned: Surface | null;
  /** The pin pointed somewhere that no longer exists; the caller forgets it. */
  clearPin: boolean;
  /** One prompt sentence when the chosen destination cannot be honoured. */
  note: string;
}

const SURFACES: ReadonlySet<string> = new Set(["cloud", "vm", "local", "browser"]);

/** Parse a surface arriving over the wire; anything else is "not said". */
export function parseSurface(value: unknown): Surface | undefined {
  // SAFETY: the set membership check is the narrowing — only the four
  // literal strings pass, and the assertion just names that fact to the type.
  return typeof value === "string" && SURFACES.has(value) ? (value as Surface) : undefined;
}

/** The per-turn computer kinds the dispatch tracks, folded to a surface. */
export function surfaceOfComputerKind(kind: "box" | "vps" | "vm" | "local" | null): Surface | null {
  if (kind === "box" || kind === "vps") return "cloud";
  return kind;
}

const NO_BROWSER_NOTE =
  " This bot is set to work in the built-in browser, but the built-in browser is switched off in App Settings, so you have no browser and no computer this turn — say so instead of guessing.";

const OFF_NOTE =
  " This bot's \"Works on\" setting is Off, so no computer and no built-in browser are mounted this turn: you cannot open a page, click, or type on any screen. If the user asks for something that needs one, tell them Works on is Off in this bot's settings — never claim you are opening a browser you do not have.";

/** Decide what a turn mounts. One place per turn: a computer destination
 * mounts only that computer (web work happens in its own browser), a browser
 * destination mounts only the built-in browser, Off mounts nothing. A
 * conversation pin — set by the person from the composer, or by the
 * conversation's own first turn on Auto — wins over the bot's default, so a
 * thread never changes place under someone; only Off overrides it. Auto
 * without a pin leaves the computer choice to the dispatch, which then
 * mounts the browser only when no computer was reached. A pin the turn
 * cannot honour is reported for clearing instead of being swapped silently. */
export function resolveSurface(input: {
  destination: Destination;
  pinnedSurface?: Surface | null;
  /** The built-in browser may mount: workspace flag, bot switch and engine. */
  browserOn: boolean;
}): SurfacePlan {
  const { destination, browserOn } = input;
  // Off is the whole answer: no computer and no browser. It used to withhold
  // only the computer, which left a bot set to Off holding the built-in
  // browser — the one surface the setting most obviously reads as forbidding,
  // and the one people then watched it reach for. The overview ("Can't use a
  // computer.") and the settings prompt preview already described Off this
  // way; the dispatch was the odd one out. A bot that should keep the browser
  // and nothing else has its own destination: Browser.
  if (destination === "off") {
    return { computer: "off", browser: false, pinned: null, clearPin: false, note: OFF_NOTE };
  }
  const pin = input.pinnedSurface ?? null;
  if (pin === "browser") {
    if (browserOn) return { computer: "off", browser: true, pinned: "browser", clearPin: false, note: "" };
    // The browser this conversation was pinned to is gone (feature or bot
    // switch off, engine missing): fall back to the default and say the pin
    // should go, rather than quietly moving the work somewhere else.
    return { ...resolveSurface({ destination, browserOn }), clearPin: true };
  }
  if (pin) return { computer: pin, browser: false, pinned: pin, clearPin: false, note: "" };
  if (destination === "browser") {
    return browserOn
      ? { computer: "off", browser: true, pinned: null, clearPin: false, note: "" }
      : { computer: "off", browser: false, pinned: null, clearPin: false, note: NO_BROWSER_NOTE };
  }
  if (destination !== undefined) {
    return { computer: destination, browser: false, pinned: null, clearPin: false, note: "" };
  }
  return { computer: undefined, browser: browserOn, pinned: null, clearPin: false, note: "" };
}

/** How the prompt and the app name a surface. Deliberately the same words
 * the panel uses, so "tell them it is on the cloud computer" points at a
 * label the person can find. */
export function surfaceLabel(surface: Surface): string {
  switch (surface) {
    case "cloud":
      return "the cloud computer";
    case "vm":
      return "the Local VM";
    case "local":
      return "this computer";
    case "browser":
      return "the built-in browser";
  }
}

/** Said once per task, so the person hears the place before the first click
 * lands there. Same words as the panel and the composer chip. */
const RESTATE_SENTENCE =
  " Before your first action on a screen or page in a task, say in one short sentence where you are working, using that same name.";

/** The one paragraph that says where this turn's work happens. Assembled
 * from what was actually mounted, never from the setting, so the model is
 * only ever told about tools it can call. */
export function surfacePrompt(
  mounted: MountedSurfaces,
  opts: { pinned?: Surface | null; note?: string } = {},
): string {
  const computer = mounted.computer ? surfaceLabel(mounted.computer) : null;
  let text = "";
  if (computer && mounted.browser) {
    text =
      ` Two surfaces are mounted this turn: the built-in browser (the browser server's browser_navigate, browser_snapshot, browser_click, browser_fill and friends) and ${computer} (the computer server's tools). Web tasks → the built-in browser. Desktop apps, files and shell → ${computer} tools. Pick one surface for a task and stay on it; if you need the user to sign in, say which surface — the Browser tab or ${computer}.`;
  } else if (computer) {
    text =
      ` Everything you do on screen happens on ${computer}, web pages included, through its own browser; there is no separate built-in browser this turn. If you need the user to sign in, tell them it is on ${computer}.`;
  } else if (mounted.browser) {
    text =
      " Everything you do on screen happens in the built-in browser tab; there is no desktop, file or shell computer this turn. If you need the user to sign in, tell them it is in the Browser tab of the Computer panel.";
  }
  if (text) text += RESTATE_SENTENCE;
  if (opts.pinned) {
    text += ` This task has been running on ${surfaceLabel(opts.pinned)}; keep using it unless the user says otherwise.`;
  }
  return text + (opts.note ?? "");
}

/** Tool names that touch a screen, for engines that report bare names.
 * Mirrors the screen-poller regex in the harness. */
const SCREEN_TOOL = /^(?:screenshot|click|type_text|press_key|scroll|open_url|wait_for|computer_|browser_)/i;

/** Which surface a completed tool call landed on, or null when it cannot
 * be told apart. The Claude driver namespaces MCP tools by server, which
 * is the only fully reliable signal; a bare name is trusted only when one
 * surface was mounted, because both servers expose `browser_snapshot`. */
export function surfaceForTool(toolName: string, mounted: MountedSurfaces): Surface | null {
  if (toolName.startsWith("mcp__browser__")) return mounted.browser ? "browser" : null;
  if (toolName.startsWith("mcp__computer__")) return mounted.computer;
  if (!SCREEN_TOOL.test(toolName)) return null;
  if (mounted.computer && !mounted.browser) return mounted.computer;
  if (!mounted.computer && mounted.browser && /^browser_/i.test(toolName)) return "browser";
  return null;
}
