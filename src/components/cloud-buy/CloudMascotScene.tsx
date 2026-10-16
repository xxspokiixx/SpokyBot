// MausBot Cloud's night shift: Maus bots take turns finishing tasks on a cloud under the moon while this computer sleeps on its hill.
import { memo, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { CalendarDays, Check, Mail, type LucideIcon } from "lucide-react";
import { MausAvatar } from "@/components/Avatar";
import { t } from "@/lib/i18n";
import { MAUS_COLORS, mausGradient, type MausColor, type MausState } from "@/lib/mascot";
import { reducedMotion } from "@/lib/onboarding";

type Variant = "hero" | "beat";
type Spot = readonly [x: number, y: number, size: number];
type Area = readonly [width: number, height: number];
type Gaze = { readonly x: number; readonly y: number };

interface Layout {
  readonly area: Area;
  readonly crew: Spot;
  readonly floater: Spot;
  readonly home: Spot;
  readonly moon: Spot;
  readonly meteor: readonly [x: number, y: number];
  readonly rise: number;
}

const CREW_AREA: Area = [220, 86];
const HOME_WIDTH = 100;
const LAYOUTS: Record<Variant, Layout> = {
  hero: { area: [320, 150], crew: [10, 60, 220], floater: [16, 10, 42], home: [210, 92, 104], moon: [278, 30, 13], meteor: [136, 12], rise: 42 },
  beat: { area: [400, 116], crew: [62, 30, 200], floater: [20, 10, 38], home: [270, 56, 114], moon: [334, 24, 11], meteor: [196, 10], rise: 30 },
};

interface Worker {
  readonly color: MausColor;
  readonly state: MausState;
  readonly spot: Spot;
  readonly rest: Gaze;
  readonly face?: number;
  readonly icon: LucideIcon;
  readonly drift: number;
}

const CREW: readonly Worker[] = [
  { color: "orange", state: "working", spot: [30, 14, 46], rest: { x: 0.35, y: 0.1 }, face: 10, icon: CalendarDays, drift: 9 },
  { color: "pink", state: "happy", spot: [84, 7, 52], rest: { x: 0, y: -0.15 }, icon: Check, drift: 3 },
  { color: "green", state: "searching", spot: [144, 14, 46], rest: { x: -0.35, y: 0.1 }, icon: Mail, drift: 5 },
];
const FINISH_ORDER = [1, 2, 0] as const;
const FLOATER = { color: "purple", state: "orbit", rest: { x: 0.3, y: 0.35 }, glance: { x: 0.8, y: 0.15 } } as const;
const UP: Gaze = { x: 0.2, y: -0.85 }, RIGHT_UP: Gaze = { x: 0.75, y: -0.55 }, LEFT_UP: Gaze = { x: -0.75, y: -0.55 };
const CHEER_FACE = 2;
const STILL = { finisher: 1, thinking: 0, popped: 2, rise: 0.7, spread: 0.75 } as const;

const PHASE_MS = { cheer: 1200, watch: 500, rest: 300, think: 2600 } as const;
type Phase = keyof typeof PHASE_MS;
const AFTER: Record<Phase, Phase> = { cheer: "watch", watch: "rest", rest: "think", think: "cheer" };
const FIRST_FINISH_MS = 1300;

const BACK_PUFFS = [[36, 50, 18], [72, 36, 26], [114, 33, 26], [152, 40, 23], [186, 50, 19]] as const;
const FRONT_PUFFS = [[28, 68, 12], [55, 65, 16], [90, 64, 18], [126, 65, 16.5], [158, 66, 15], [190, 68, 12.5]] as const;
const CLOUDLET = [[30, 93, 12], [52, 87, 16], [74, 93, 12]] as const;
const STARS = [
  [3, 20, 1.1, 0, 0], [7, 56, 0.8, 0, 0], [11, 8, 1.3, 4.2, -2.6], [21, 46, 0.8, 0, 0], [26, 12, 0.9, 0, 0],
  [33, 4, 1.1, 0, 0], [38, 26, 0.7, 0, 0], [45, 9, 1.2, 3.8, -2], [51, 3, 0.8, 0, 0], [57, 24, 1, 0, 0],
  [62, 8, 0.7, 0, 0], [68, 30, 0.9, 3.3, -1.5], [73, 6, 1.1, 0, 0], [87, 32, 1, 0, 0], [92, 9, 1.2, 0, 0], [97, 44, 0.9, 0, 0],
] as const;
const SPARKLES = [[16, 30, 3.2, 3.9, -1.4, "#ffc4e4"], [64, 16, 2.6, 4.4, -2.9, "#b5f2ff"], [95, 24, 2.4, 3.6, -0.6, "#ffe9a8"]] as const;
const BURST_COLORS: readonly MausColor[] = ["orange", "pink", "green", "purple", "yellow"];
const BITS = Array.from({ length: 12 }, (_, piece) => {
  const angle = (piece / 12) * Math.PI * 2 + 0.4;
  const reach = 10 + (piece % 3) * 4;
  return { x: Math.round(Math.cos(angle) * reach * 10) / 10, y: Math.round((Math.sin(angle) * reach * 0.8 - 1.5) * 10) / 10,
    turn: (piece % 2 ? 1 : -1) * (150 + piece * 20), color: BURST_COLORS[piece % BURST_COLORS.length]!, dot: piece % 3 === 2 };
});

const percent = (part: number, whole: number) => `${(part / whole) * 100}%`;
const place = ([x, y, width]: Spot, [areaWidth, areaHeight]: Area, height = width): CSSProperties => ({
  left: percent(x, areaWidth), top: percent(y, areaHeight), width: percent(width, areaWidth), height: percent(height, areaHeight),
});
const twinkle = (live: boolean, seconds: number, offset: number): { className?: string; style?: CSSProperties } =>
  live && seconds ? { className: "cloud-scene-twinkle", style: { animationDuration: `${seconds}s`, animationDelay: `${offset}s` } } : {};
const sparkle = (r: number) => {
  const k = r * 0.18;
  return `M0 ${-r}Q${k} ${-k} ${r} 0Q${k} ${k} 0 ${r}Q${-k} ${k} ${-r} 0Q${-k} ${-k} 0 ${-r}Z`;
};
const gazeOf = (index: number, finisher: number): Gaze =>
  finisher < 0 ? CREW[index]!.rest : finisher === index ? UP : CREW[finisher]!.spot[0] > CREW[index]!.spot[0] ? RIGHT_UP : LEFT_UP;
const launchAt = ([x, y, size]: Spot) => [x + size * 0.62, y + size * 0.36] as const;

function subscribeReducedMotion(changed: () => void) {
  const query = globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)");
  query?.addEventListener?.("change", changed);
  const root = globalThis.document?.documentElement;
  const hook = root && typeof MutationObserver === "function" ? new MutationObserver(changed) : null;
  if (root) hook?.observe(root, { attributes: true, attributeFilter: ["data-reduced-motion"] });
  return () => {
    query?.removeEventListener?.("change", changed);
    hook?.disconnect();
  };
}

function useInView(target: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const node = target.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const watch = new IntersectionObserver(entries => setInView(entries.at(-1)?.isIntersecting ?? true));
    watch.observe(node);
    return () => watch.disconnect();
  }, [target]);
  return inView;
}

/** One finished task every 4.6 s: the finisher hops and sends its token up, the others watch it pop, the next one thinks. */
function useShift(moving: boolean) {
  const [shift, setShift] = useState<{ done: number; phase: Phase }>({ done: 0, phase: "think" });
  useEffect(() => {
    if (!moving) return;
    const timer = setTimeout(() => setShift({ done: shift.phase === "think" ? shift.done + 1 : shift.done, phase: AFTER[shift.phase] }),
      shift.done === 0 ? FIRST_FINISH_MS : PHASE_MS[shift.phase]);
    return () => clearTimeout(timer);
  }, [moving, shift]);
  return shift;
}

function Token({ worker, rise, paint, held }: { worker: Worker; rise: number; paint: string; held?: number }) {
  const Icon = worker.icon;
  const [x, y] = launchAt(worker.spot);
  const flight = { "--cloud-scene-dx": `${worker.drift}px`, "--cloud-scene-dy": `${-rise}px` } as CSSProperties;
  return <>
    <g data-token={worker.color} transform={`translate(${x} ${y})`}>
      <g className={held === undefined ? "cloud-scene-token" : undefined} style={held === undefined ? flight : undefined}
        transform={held === undefined ? undefined : `translate(${worker.drift * held} ${-rise * held})`}>
        <circle r="10.5" fill={MAUS_COLORS[worker.color]} opacity=".25" />
        <circle r="7.2" fill={paint} stroke="#fff" strokeOpacity=".55" strokeWidth=".8" />
        <ellipse cx="-2.4" cy="-3.6" rx="3.4" ry="1.7" fill="#fff" opacity=".4" />
        <Icon x={-4} y={-4} size={8} color="#fff" strokeWidth={3} aria-hidden="true" />
      </g>
    </g>
    {held === undefined && <Burst worker={worker} rise={rise} />}
  </>;
}

function Burst({ worker, rise, spread }: { worker: Worker; rise: number; spread?: number }) {
  const [x, y] = launchAt(worker.spot);
  return <g data-burst={worker.color} transform={`translate(${x + worker.drift} ${y - rise})`}>
    {BITS.map((bit, piece) => {
      const [light, fill] = mausGradient(bit.color);
      const motion = spread === undefined
        ? { className: "cloud-scene-bit", style: { "--cloud-scene-bx": `${bit.x}px`, "--cloud-scene-by": `${bit.y}px`, "--cloud-scene-turn": `${bit.turn}deg` } as CSSProperties }
        : { transform: `translate(${bit.x * spread} ${bit.y * spread + spread * 2}) rotate(${bit.turn * spread})` };
      return bit.dot ? <circle key={piece} r="1.6" fill={light} {...motion} /> : <rect key={piece} x="-2.5" y="-1" width="5" height="2" rx="1" fill={fill} {...motion} />;
    })}
  </g>;
}

function Thought({ worker, on }: { worker: Worker; on: boolean }) {
  const [x, y, size] = worker.spot;
  return <g transform={`translate(${x + size * 0.8} ${y + size * 0.12})`}>
    <g className="cloud-scene-think" data-thought={worker.color} data-on={on ? "" : undefined}>
      <circle cx="-2.8" cy="7.4" r="1.2" fill="#fff" />
      <circle cx="-.6" cy="4.6" r="1.8" fill="#fff" />
      <rect x="0" y="-7" width="19" height="9.5" rx="4.75" fill="#fff" />
      <g transform="translate(5 -2.25) scale(.45)">
        {[0, 10, 20].map(cx => <circle key={cx} className="cloud-scene-dot" cx={cx} r="3.2" fill={MAUS_COLORS[worker.color]} />)}
      </g>
    </g>
  </g>;
}

function Laptop({ live, metal, glass }: { live: boolean; metal: string; glass: string }) {
  return <g transform="translate(46 32)">
    <ellipse cx="4" cy="2.6" rx="29" ry="3.6" fill="#000" opacity=".32" />
    <path d="M-21-1.5 19 1v2.2l-40-2.5Z" fill="#8a92b1" />
    <path d="M19 1 27-6.5v2.2L19 3.2Z" fill="#646c8c" />
    <path d="M-21-1.5 19 1 27-6.5-13-9Z" fill={metal} stroke="#eef0f8" strokeWidth=".7" strokeLinejoin="round" />
    <path d="M-15.4-6.3 15.6-4.4 20.5-8.4-10.6-10.3Z" fill="#4b5272" opacity=".55" transform="translate(.6 2.2)" />
    <path d="M-3.3-.6 5.3-.1 6.9-2.2-1.7-2.7Z" fill="#fff" opacity=".55" />
    <path d="M-13-9 27-6.5 29.2-31.6-10.8-34.1Z" fill="#c9cee0" />
    <path d="M-11.6-10.4 25.6-8.1 27.5-30.1-9.7-32.4Z" fill={glass} />
    <path d="M-2.5-31.8 10.6-31 0-9.5-13.1-10.3Z" fill="#fff" opacity=".07" />
    <circle cx="13.3" cy="2.35" r=".95" fill="#b6f5d2" className={live ? "cloud-scene-led" : undefined} />
  </g>;
}

const Z = "M-2.4-2.4h4.8l-4.8 4.8h4.8";
const STILL_BUBBLES = [[76, -4, 0.62, 0.75], [83, -15, 0.85, 0.9], [92, -27, 1.08, 1]] as const;

function Bubble({ className, style, transform, opacity }: { className?: string; style?: CSSProperties; transform?: string; opacity?: number }) {
  return <g className={className} style={style} transform={transform} opacity={opacity}>
    <circle r="7.5" fill="var(--cloud-scene-bubble)" stroke="var(--cloud-scene-bubble-edge)" strokeWidth="1" />
    <circle cx="-4.3" cy="-4.3" r="1.1" fill="#fff" opacity=".85" />
    <path d={Z} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </g>;
}

function Sleepers({ live }: { live: boolean }) {
  if (!live) return <g>{STILL_BUBBLES.map(([x, y, scale, opacity]) => <Bubble key={x} transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity} />)}</g>;
  return <g transform="translate(76 -4)">
    {[0, -1.6, -3.2].map(offset => <Bubble key={offset} className="cloud-scene-z" style={{ animationDelay: `${offset}s` }} />)}
  </g>;
}

/** The Cloud scene for the buying sheet ("hero") and the welcome's Cloud beat ("beat"). `paused` holds it while something
 * covers it; reduced motion gets one still frame of the same scene. */
export const CloudMascotScene = memo(function CloudMascotScene({ variant, paused = false }: { variant: Variant; paused?: boolean }) {
  const layout = LAYOUTS[variant];
  const uid = `cloud-scene${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root);
  const still = useSyncExternalStore(subscribeReducedMotion, reducedMotion, reducedMotion);
  const live = !still;
  const moving = live && !paused && inView;
  const shift = useShift(moving);
  const finisher = still ? STILL.finisher : shift.done > 0 ? FINISH_ORDER[(shift.done - 1) % FINISH_ORDER.length]! : -1;
  const cheering = live && shift.phase === "cheer" ? finisher : -1;
  const watching = still || shift.phase === "cheer" || shift.phase === "watch" ? finisher : -1;
  const thinking = still ? STILL.thinking : shift.phase === "think" ? FINISH_ORDER[shift.done % FINISH_ORDER.length]! : -1;
  const [areaWidth, areaHeight] = layout.area;
  const [moonX, moonY, moonR] = layout.moon;
  const [homeX, homeY, homeWidth] = layout.home;
  const crewHeight = (layout.crew[2] * CREW_AREA[1]) / CREW_AREA[0];
  const url = (name: string) => `url(#${uid}-${name})`;
  const bot = { trackPointer: false, forward: still, lookAround: still ? 0 : 0.6, animated: moving } as const;

  return <div ref={root} role="img" aria-label={t("cloudScene.label")} data-cloud-scene={variant} data-still={still ? "" : undefined}
    data-paused={live && !moving ? "" : undefined} className={`cloud-scene cloud-scene-${variant}`}>
    <svg className="cloud-scene-layer" aria-hidden="true">
      {STARS.map(([x, y, r, seconds, offset]) => <circle key={`${x}-${y}`} cx={`${x}%`} cy={`${y}%`} r={r} fill="var(--cloud-scene-star)"
        opacity={seconds ? undefined : 0.7} {...twinkle(live, seconds, offset)} />)}
      {SPARKLES.map(([x, y, r, seconds, offset, tint]) => <svg key={`${x}-${y}`} x={`${x}%`} y={`${y}%`} overflow="visible">
        <path d={sparkle(r)} fill={tint} {...twinkle(live, seconds, offset)} />
      </svg>)}
    </svg>
    <div className="cloud-scene-stage">
      <svg className="cloud-scene-layer" viewBox={`0 0 ${areaWidth} ${areaHeight}`} aria-hidden="true">
        <defs>
          <radialGradient id={`${uid}-halo`}>
            <stop offset="0" style={{ stopColor: "var(--cloud-scene-moon-glow)" }} />
            <stop offset="1" style={{ stopColor: "var(--cloud-scene-moon-glow)", stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id={`${uid}-moon`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff4c9" />
            <stop offset="1" stopColor="#f6c453" />
          </linearGradient>
          <mask id={`${uid}-crescent`}>
            <rect width={areaWidth} height={areaHeight} fill="#fff" />
            <circle cx={moonX + moonR * 0.42} cy={moonY - moonR * 0.34} r={moonR * 0.86} fill="#000" />
          </mask>
          <linearGradient id={`${uid}-tail`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="-26" y2="-9">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".4" stopColor="#a5f3fc" stopOpacity=".7" />
            <stop offset="1" stopColor="#c4b5fd" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-lid`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f6f7fc" />
            <stop offset="1" stopColor="#b7bdd6" />
          </linearGradient>
          <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#262c52" />
            <stop offset="1" stopColor="#0d1024" />
          </linearGradient>
          <linearGradient id={`${uid}-hill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--cloud-scene-hill-top)" }} />
            <stop offset=".5" style={{ stopColor: "var(--cloud-scene-hill-bottom)" }} />
          </linearGradient>
          <radialGradient id={`${uid}-mist`}>
            <stop offset="0" style={{ stopColor: "var(--cloud-scene-mist)" }} />
            <stop offset="1" style={{ stopColor: "var(--cloud-scene-mist)", stopOpacity: 0 }} />
          </radialGradient>
          <radialGradient id={`${uid}-lamp`}>
            <stop offset="0" style={{ stopColor: "var(--cloud-scene-lamp)", stopOpacity: 0.62 }} />
            <stop offset=".55" style={{ stopColor: "var(--cloud-scene-lamp)", stopOpacity: 0.22 }} />
            <stop offset="1" style={{ stopColor: "var(--cloud-scene-lamp)", stopOpacity: 0 }} />
          </radialGradient>
          <radialGradient id={`${uid}-shadow`}>
            <stop offset="0" style={{ stopColor: "var(--cloud-scene-cloud-shade)", stopOpacity: 0.85 }} />
            <stop offset="1" style={{ stopColor: "var(--cloud-scene-cloud-shade)", stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id={`${uid}-back`} gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="80">
            <stop offset="0" style={{ stopColor: "var(--cloud-scene-cloud-top)" }} />
            <stop offset="1" style={{ stopColor: "var(--cloud-scene-cloud-shade)" }} />
          </linearGradient>
          <linearGradient id={`${uid}-puff`} gradientUnits="userSpaceOnUse" x1="0" y1="72" x2="0" y2="104">
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" style={{ stopColor: "var(--cloud-scene-cloud-low)" }} />
          </linearGradient>
          <linearGradient id={`${uid}-front`} gradientUnits="userSpaceOnUse" x1="0" y1="44" x2="0" y2="82">
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" style={{ stopColor: "var(--cloud-scene-cloud-low)" }} />
          </linearGradient>
          {CREW.map(({ color }) => <linearGradient key={color} id={`${uid}-token-${color}`} x1="0" y1="0" x2="1" y2="1">
            {mausGradient(color).map((stop, index) => <stop key={stop} offset={index / 2} stopColor={stop} />)}
          </linearGradient>)}
        </defs>
        <circle cx={moonX} cy={moonY} r={moonR * 2.7} fill={url("halo")} />
        <circle cx={moonX} cy={moonY} r={moonR} fill={url("moon")} mask={url("crescent")} />
        {live && <g transform={`translate(${layout.meteor[0]} ${layout.meteor[1]})`}>
          <g className="cloud-scene-meteor">
            <path d="M0 0-26-9" stroke={url("tail")} strokeWidth="1.4" strokeLinecap="round" />
            <circle r="1.3" fill="#fff" />
          </g>
        </g>}
        <g transform={`translate(${homeX} ${homeY}) scale(${homeWidth / HOME_WIDTH})`}>
          <path d="M-14 62C-2 45 16 35 46 34.6S110 37.5 400 45V62Z" fill={url("hill")} />
          <path d="M-14 62C-2 45 16 35 46 34.6S110 37.5 400 45" fill="none" stroke="var(--cloud-scene-rim)" strokeWidth="1" />
          <Laptop live={live} metal={url("lid")} glass={url("glass")} />
          <Sleepers live={live} />
        </g>
      </svg>
      <div className={live ? "cloud-scene-box cloud-scene-drift" : "cloud-scene-box"} style={place(layout.floater, layout.area)}>
        <MausAvatar {...bot} color={FLOATER.color} state={FLOATER.state} size={layout.floater[2]} gaze={watching < 0 ? FLOATER.rest : FLOATER.glance} />
        <svg className="cloud-scene-layer" viewBox="0 0 100 100" aria-hidden="true">
          <g fill={url("puff")}>
            <rect x="18" y="88" width="68" height="15" rx="7.5" />
            {CLOUDLET.map(([cx, cy, r]) => <circle key={cx} cx={cx} cy={cy} r={r} />)}
          </g>
        </svg>
      </div>
      <div className={live ? "cloud-scene-box cloud-scene-float" : "cloud-scene-box"} style={place(layout.crew, layout.area, crewHeight)}>
        <svg className="cloud-scene-layer" viewBox={`0 0 ${CREW_AREA[0]} ${CREW_AREA[1]}`} aria-hidden="true">
          <ellipse cx="110" cy="50" rx="140" ry="62" fill={url("mist")} />
          <g fill={url("back")}>
            <rect x="10" y="44" width="200" height="34" rx="17" />
            {BACK_PUFFS.map(([cx, cy, r]) => <circle key={cx} cx={cx} cy={cy} r={r} />)}
          </g>
          {CREW.map(({ color, spot: [x, y, size] }) => <ellipse key={color} cx={x + size * 0.5} cy={y + size * 0.8} rx={size * 0.5} ry={size * 0.13} fill={url("shadow")} />)}
          {still ? <>
            <Token worker={CREW[STILL.finisher]!} rise={layout.rise} paint={url(`token-${CREW[STILL.finisher]!.color}`)} held={STILL.rise} />
            <Burst worker={CREW[STILL.popped]!} rise={layout.rise} spread={STILL.spread} />
          </> : finisher >= 0 && <Token key={shift.done} worker={CREW[finisher]!} rise={layout.rise} paint={url(`token-${CREW[finisher]!.color}`)} />}
        </svg>
        {CREW.map((worker, index) => <div key={worker.color} className={index === cheering ? "cloud-scene-box cloud-scene-hop" : "cloud-scene-box"}
          style={place(worker.spot, CREW_AREA)}>
          <MausAvatar {...bot} color={worker.color} state={worker.state} size={worker.spot[2]} gaze={gazeOf(index, watching)}
            expression={index === cheering || (still && index === finisher) ? CHEER_FACE : worker.face}
            motion={index === cheering ? "blink" : "none"} motionKey={shift.done} />
        </div>)}
        <svg className="cloud-scene-layer" viewBox={`0 0 ${CREW_AREA[0]} ${CREW_AREA[1]}`} aria-hidden="true">
          <g fill={url("front")}>
            <rect x="15" y="60" width="190" height="20" rx="10" />
            {FRONT_PUFFS.map(([cx, cy, r]) => <circle key={cx} cx={cx} cy={cy} r={r} />)}
          </g>
          {CREW.map(({ color, spot: [x, y, size] }) => <ellipse key={color} cx={x + size * 0.48} cy={y + size * 1.02} rx={size * 0.66} ry={size * 0.17} fill={url("lamp")} />)}
          {CREW.map((worker, index) => <Thought key={worker.color} worker={worker} on={index === thinking} />)}
        </svg>
      </div>
    </div>
  </div>;
});
