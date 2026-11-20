import { dataEngine as engine } from "./engine.js";
import { compileChart as compile } from "./chart-compiler.js";
export const dataEngine = engine;
export const compileChart = compile;
// Vega, Vega-Lite and its JSON schema load at the first chart, not with the server.
export const validateVegaLite = async (spec) => (await import("./vega-lite-validator.js")).validateVegaLite(spec);
export const chartRenderer = {
    svg: async (...args) => (await import("./render.js")).chartRenderer.svg(...args),
    png: async (...args) => (await import("./render.js")).chartRenderer.png(...args),
};
