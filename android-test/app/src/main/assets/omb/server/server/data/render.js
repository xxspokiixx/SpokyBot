import { None, logger, parse, View } from "vega";
import { compile } from "vega-lite";
import { vegaConfig, vegaSurface } from "../../shared/vega-config.js";
import { columnClass } from "./chart-compiler.js";
import { nativeRequire } from "./engine.js";
/** Required at first use from the staged tree: a static import would make esbuild bundle its .node file, which it cannot. */
let resvgModule = null;
function loadResvg() {
    resvgModule ??= nativeRequire()("@resvg/resvg-js");
    return resvgModule.Resvg;
}
export const DEFAULT_WIDTH = 720;
/** A naive date or timestamp is wall-clock time, parsed in the local zone: `new Date("2024-03-01")` would be UTC midnight. */
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;
export function parseTemporal(text) {
    const m = NAIVE.exec(text);
    if (m) {
        const millis = m[7] ? Number(m[7].padEnd(3, "0").slice(0, 3)) : 0;
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), millis);
    }
    const zoned = new Date(text.replace(" ", "T"));
    return Number.isNaN(zoned.getTime()) ? text : zoned;
}
export function coerceRows(rows, columns) {
    const coercers = columns.map((column) => {
        const cls = columnClass(column.type);
        if (cls === "numeric")
            return (v) => (typeof v === "string" ? Number(v) : v);
        if (cls === "temporal")
            return (v) => (typeof v === "string" ? parseTemporal(v) : v);
        return (v) => v;
    });
    return rows.map((row) => {
        const datum = {};
        columns.forEach((column, i) => {
            datum[column.name] = coercers[i](row[i] ?? null);
        });
        return datum;
    });
}
const silent = logger(None);
function sized(vegaLite, width) {
    const spec = { ...vegaLite };
    if (spec.width === "container" || (spec.width === undefined && ("mark" in spec || "layer" in spec)))
        spec.width = width;
    return spec;
}
async function svg(vegaLite, rows, columns, options) {
    const spec = sized(vegaLite, options.width ?? DEFAULT_WIDTH);
    const { spec: runtime } = compile(spec, { config: vegaConfig(options.theme), logger: silent });
    const view = new View(parse(runtime), { renderer: "none" }).logger(silent);
    try {
        view.data("table", coerceRows(rows, columns));
        return await view.toSVG();
    }
    finally {
        view.finalize();
    }
}
async function png(vegaLite, rows, columns, options) {
    const width = options.width ?? DEFAULT_WIDTH;
    const markup = await svg(vegaLite, rows, columns, { theme: options.theme, width });
    // A PNG lands in an email or Slack message that paints no ground of its own, so it gets the theme's surface.
    const Resvg = loadResvg();
    const image = new Resvg(markup, {
        fitTo: { mode: "width", value: Math.round(width * (options.scale ?? 1)) },
        background: vegaSurface(options.theme),
        font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
    });
    return Buffer.from(image.render().asPng());
}
export const chartRenderer = { svg, png };
